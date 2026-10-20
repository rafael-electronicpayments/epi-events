-- 2026-10-20 owner request: expense entry and HR reporting.
-- Staff and contractors enter their own expenses (fields follow EPI's expense template) with an optional
-- receipt photo or PDF in the private Storage bucket "receipts". Admins tick to approve. Approved expenses
-- are locked for their owner. Receipts are visible only to their owner and admins.

create table public.expenses (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  category text not null check (category in ('breakfast', 'lunch', 'dinner', 'baggage', 'transportation', 'parking', 'other')),
  location text not null default '' check (length(location) <= 200),
  receipt_ref text not null default '' check (length(receipt_ref) <= 100),
  spent_on date not null,
  amount numeric(10, 2) not null check (amount > 0 and amount < 100000),
  payment text not null check (payment in ('cash', 'corporate_amex', 'personal_card', 'guest_room')),
  reimburse boolean not null default false,
  notes text not null default '' check (length(notes) <= 1000),
  receipt_path text unique,
  receipt_type text check (receipt_type is null or receipt_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  approved boolean not null default false,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category <> 'other' or length(btrim(notes)) > 0)
);
create index expenses_event_person_idx on public.expenses(event_id, person_id);
create index expenses_person_idx on public.expenses(person_id);

alter table public.expenses enable row level security;
create policy expenses_read on public.expenses for select to authenticated
  using (ops_private.is_admin() or person_id = ops_private.person_id());
revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;

-- Private receipts bucket. Objects live at "<person id>/<random>.<ext>"; owners reach only their own folder.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts' and (ops_private.is_admin() or split_part(name, '/', 1) = ops_private.person_id()::text))$p$;
    execute $p$create policy receipts_select on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and (ops_private.is_admin() or split_part(name, '/', 1) = ops_private.person_id()::text))$p$;
    execute $p$create policy receipts_delete on storage.objects for delete to authenticated
      using (bucket_id = 'receipts' and (ops_private.is_admin() or split_part(name, '/', 1) = ops_private.person_id()::text))$p$;
  end if;
end;
$$;

-- Snapshot: everything from before, plus expenses (admins: everyone; others: their own).
alter function public.ops_snapshot() rename to ops_snapshot_v2;
alter function public.ops_snapshot_v2() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v2() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v2();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object('expenses', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'e', x.person_id, 'ev', x.event_id, 'cat', x.category, 'loc', x.location, 'ref', x.receipt_ref,
      'date', x.spent_on, 'amt', x.amount, 'pay', x.payment, 'reimb', x.reimburse, 'notes', x.notes,
      'rp', x.receipt_path, 'rt', x.receipt_type, 'ok', x.approved, 'okAt', x.approved_at) order by x.spent_on, x.id)
    from public.expenses x join public.people e on e.id = x.person_id
    where (admin or x.person_id = pid) and (admin or not e.archived)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: expense actions are handled here; everything else goes to the previous command function unchanged.
--   addExpense [eventId, expense]   editExpense [id, expense]   delExpense [id]   approveExpense [id, true|false]
--   expense = {e?, cat, loc, ref, date, amt, pay, reimb, notes, rp?, rt?}  (e: admins only, defaults to the caller)
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v3;
alter function public.ops_command_v3(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v3(text, jsonb, integer) from public, anon, authenticated;

create function ops_private.check_expense(obj jsonb, owner integer) returns void language plpgsql stable
security definer set search_path = '' as $$
declare uploaded boolean;
begin
  if coalesce(obj->>'cat', '') not in ('breakfast', 'lunch', 'dinner', 'baggage', 'transportation', 'parking', 'other') then raise exception 'Choose an expense type.'; end if;
  if coalesce(obj->>'pay', '') not in ('cash', 'corporate_amex', 'personal_card', 'guest_room') then raise exception 'Choose a payment method.'; end if;
  if coalesce(obj->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the expense date.'; end if;
  if coalesce(obj->>'amt', '') !~ '^\d{1,5}(\.\d{1,2})?$' or (obj->>'amt')::numeric <= 0 then raise exception 'Enter an amount greater than zero (up to two decimals).'; end if;
  if obj->>'cat' = 'other' and coalesce(btrim(obj->>'notes'), '') = '' then raise exception 'Add a note describing this expense.'; end if;
  if nullif(obj->>'rp', '') is not null then
    if obj->>'rp' !~ ('^' || owner || '/[A-Za-z0-9-]+\.(jpg|jpeg|png|webp|heic|heif|pdf)$') then raise exception 'Invalid receipt location.'; end if;
    if coalesce(obj->>'rt', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then raise exception 'Receipts must be a photo or a PDF.'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where bucket_id = ''receipts'' and name = $1)' into uploaded using obj->>'rp';
      if not uploaded then raise exception 'The receipt was not uploaded. Try again.'; end if;
    end if;
  end if;
end;
$$;
revoke all on function ops_private.check_expense(jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; pid integer; owner integer; x public.expenses; obj jsonb;
begin
  if action not in ('addExpense', 'editExpense', 'delExpense', 'approveExpense') then
    return ops_private.ops_command_v3(action, args, expected_revision);
  end if;
  admin := coalesce(ops_private.is_admin(), false);
  pid := ops_private.person_id();
  if not admin and pid is null then raise exception 'Only people on the roster can enter expenses.' using errcode = '42501'; end if;
  if action = 'approveExpense' and not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  if action <> 'addExpense' then
    select * into x from public.expenses where id = (args->>0)::integer;
    if x.id is null then raise exception 'Expense no longer exists.'; end if;
    if not admin and x.person_id <> pid then raise exception 'Access denied.' using errcode = '42501'; end if;
    if not admin and x.approved and action in ('editExpense', 'delExpense') then raise exception 'This expense is approved and can no longer be changed. Ask an administrator.'; end if;
  end if;
  case action
    when 'addExpense' then
      obj := args->1;
      if not exists(select 1 from public.events where id = (args->>0)::integer) then raise exception 'Choose an event.'; end if;
      owner := case when admin and obj ? 'e' and jsonb_typeof(obj->'e') = 'number' then (obj->>'e')::integer else pid end;
      if owner is null or not exists(select 1 from public.people where id = owner and not archived) then raise exception 'Choose an active person.'; end if;
      perform ops_private.check_expense(obj, owner);
      insert into public.expenses(event_id, person_id, category, location, receipt_ref, spent_on, amount, payment, reimburse, notes, receipt_path, receipt_type)
        values((args->>0)::integer, owner, obj->>'cat', btrim(coalesce(obj->>'loc', '')), btrim(coalesce(obj->>'ref', '')), (obj->>'date')::date,
          (obj->>'amt')::numeric, obj->>'pay', coalesce((obj->>'reimb')::boolean, false), btrim(coalesce(obj->>'notes', '')),
          nullif(obj->>'rp', ''), case when nullif(obj->>'rp', '') is null then null else obj->>'rt' end);
    when 'editExpense' then
      obj := args->1;
      perform ops_private.check_expense(obj, x.person_id);
      update public.expenses set category = obj->>'cat', location = btrim(coalesce(obj->>'loc', '')), receipt_ref = btrim(coalesce(obj->>'ref', '')),
        spent_on = (obj->>'date')::date, amount = (obj->>'amt')::numeric, payment = obj->>'pay', reimburse = coalesce((obj->>'reimb')::boolean, false),
        notes = btrim(coalesce(obj->>'notes', '')), receipt_path = nullif(obj->>'rp', ''),
        receipt_type = case when nullif(obj->>'rp', '') is null then null else obj->>'rt' end, updated_at = now()
        where id = x.id;
    when 'delExpense' then
      delete from public.expenses where id = x.id;
    when 'approveExpense' then
      update public.expenses set approved = coalesce((args->>1)::boolean, false),
        approved_at = case when coalesce((args->>1)::boolean, false) then now() end,
        approved_by = case when coalesce((args->>1)::boolean, false) then auth.uid() end
        where id = x.id;
  end case;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
