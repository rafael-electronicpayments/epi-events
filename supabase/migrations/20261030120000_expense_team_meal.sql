-- 2026-10-27 owner request (Expenses): two new expense types.
--   Team Meal: the person picks who was at the meal (people from People); at least one is required.
--   ISO/Rep Hosting: no people picker; names and details go in the notes, which are required (like Other).
-- Run exactly once (it renames functions).

alter table public.expenses add column attendees integer[] not null default '{}' check (cardinality(attendees) <= 200);
alter table public.expenses drop constraint expenses_category_check,
  add constraint expenses_category_check check (category in ('breakfast', 'lunch', 'dinner', 'baggage', 'transportation', 'parking', 'other',
    'airfare', 'hotel', 'team_meal', 'iso_hosting'));
alter table public.expenses drop constraint expenses_check,
  add constraint expenses_check check (category not in ('other', 'iso_hosting') or length(btrim(notes)) > 0);

create or replace function ops_private.check_expense(obj jsonb, owner integer) returns void language plpgsql stable
security definer set search_path = '' as $$
declare uploaded boolean;
begin
  if coalesce(obj->>'cat', '') not in ('breakfast', 'lunch', 'dinner', 'baggage', 'transportation', 'parking', 'other', 'airfare', 'hotel', 'team_meal', 'iso_hosting') then raise exception 'Choose an expense type.'; end if;
  if coalesce(obj->>'pay', '') not in ('cash', 'corporate_amex', 'personal_card', 'guest_room') then raise exception 'Choose a payment method.'; end if;
  if coalesce(obj->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the expense date.'; end if;
  if coalesce(obj->>'amt', '') !~ '^\d{1,5}(\.\d{1,2})?$' or (obj->>'amt')::numeric <= 0 then raise exception 'Enter an amount greater than zero (up to two decimals).'; end if;
  if obj->>'cat' = 'other' and coalesce(btrim(obj->>'notes'), '') = '' then raise exception 'Add a note describing this expense.'; end if;
  if obj->>'cat' = 'iso_hosting' and coalesce(btrim(obj->>'notes'), '') = '' then raise exception 'Please add names and details to the notes.'; end if;
  if nullif(obj->>'rp', '') is null then raise exception 'Attach a photo or PDF of the receipt.'; end if;
  if obj->>'rp' !~ ('^' || owner || '/[A-Za-z0-9-]+\.(jpg|jpeg|png|webp|heic|heif|pdf)$') then raise exception 'Invalid receipt location.'; end if;
  if coalesce(obj->>'rt', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then raise exception 'Receipts must be a photo or a PDF.'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists(select 1 from storage.objects where bucket_id = ''receipts'' and name = $1)' into uploaded using obj->>'rp';
    if not uploaded then raise exception 'The receipt was not uploaded. Try again.'; end if;
  end if;
end;
$$;
revoke all on function ops_private.check_expense(jsonb, integer) from public, anon, authenticated;

-- Snapshot: each expense gets "att" (the people at a team meal) when it has any; "teamMeals": true tells the app this
-- database supports the new types.
alter function public.ops_snapshot() rename to ops_snapshot_v22;
alter function public.ops_snapshot_v22() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v22() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v22();
  snapshot := snapshot || jsonb_build_object('teamMeals', true);
  if jsonb_typeof(snapshot->'expenses') <> 'array' then return snapshot; end if;
  return snapshot || jsonb_build_object('expenses', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('att', to_jsonb(e.attendees))
      from public.expenses e where e.id = (x->>'id')::integer and cardinality(e.attendees) > 0), '{}'::jsonb) order by n)
    from jsonb_array_elements(snapshot->'expenses') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: addExpense [eventId, body] and editExpense [id, body] take "att": [personId, ...] in the body; a Team
-- Meal needs at least one active person, and other types store none. Everything else is unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v23;
alter function public.ops_command_v23(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v23(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare body jsonb; att integer[]; result jsonb; target integer;
begin
  if action not in ('addExpense', 'editExpense') then return ops_private.ops_command_v23(action, args, expected_revision); end if;
  body := args->1;
  att := '{}';
  if body->>'cat' = 'team_meal' then
    if jsonb_typeof(body->'att') = 'array' then
      select coalesce(array_agg(p.id order by p.name), '{}') into att
        from (select distinct x::integer id from jsonb_array_elements_text(body->'att') x) a join public.people p on p.id = a.id and not p.archived;
    end if;
    if cardinality(att) = 0 then raise exception 'Choose who was at the team meal.'; end if;
    if cardinality(att) > 200 then raise exception 'Choose up to 200 people.'; end if;
  end if;
  result := ops_private.ops_command_v23(action, args, expected_revision);
  -- Writes are serialized by the ops_state row lock, so the newest expense is the one just added.
  target := case when action = 'addExpense' then (select max(id) from public.expenses) else (args->>0)::integer end;
  update public.expenses set attendees = att where id = target and attendees is distinct from att;
  if found then result := public.ops_snapshot(); end if;
  return result;
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
