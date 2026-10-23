-- 2026-10-23 owner request: Itineraries, part 2 (expenses). "Add to expenses" on a flight or hotel creates the
-- traveler's expenses, with a receipt photo or PDF required: Airfare for the flight cost, a separate Baggage
-- expense for the bag fee, and Hotel for the folio total. Nothing is added for Points or Event/master bill
-- bookings, except a bag fee. Reimburse follows the booking (default yes for Personal card, no for Company Amex).
-- Once a linked expense is approved, the traveler can't change that booking's costs or delete it; admins can,
-- and an admin's change to an approved amount sends the expense back for approval.
-- Linked expenses are changed through the booking, not on the Expenses screen (admins can still edit them there).
-- Run exactly once.

alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('breakfast', 'lunch', 'dinner', 'baggage', 'transportation', 'parking', 'other', 'airfare', 'hotel'));

create or replace function ops_private.check_expense(obj jsonb, owner integer) returns void language plpgsql stable
security definer set search_path = '' as $$
declare uploaded boolean;
begin
  if coalesce(obj->>'cat', '') not in ('breakfast', 'lunch', 'dinner', 'baggage', 'transportation', 'parking', 'other', 'airfare', 'hotel') then raise exception 'Choose an expense type.'; end if;
  if coalesce(obj->>'pay', '') not in ('cash', 'corporate_amex', 'personal_card', 'guest_room') then raise exception 'Choose a payment method.'; end if;
  if coalesce(obj->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the expense date.'; end if;
  if coalesce(obj->>'amt', '') !~ '^\d{1,5}(\.\d{1,2})?$' or (obj->>'amt')::numeric <= 0 then raise exception 'Enter an amount greater than zero (up to two decimals).'; end if;
  if obj->>'cat' = 'other' and coalesce(btrim(obj->>'notes'), '') = '' then raise exception 'Add a note describing this expense.'; end if;
  if nullif(obj->>'rp', '') is null then raise exception 'Attach a photo or PDF of the receipt.'; end if;
  if obj->>'rp' !~ ('^' || owner || '/[A-Za-z0-9-]+\.(jpg|jpeg|png|webp|heic|heif|pdf)$') then raise exception 'Invalid receipt location.'; end if;
  if coalesce(obj->>'rt', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then raise exception 'Receipts must be a photo or a PDF.'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists(select 1 from storage.objects where bucket_id = ''receipts'' and name = $1)' into uploaded using obj->>'rp';
    if not uploaded then raise exception 'The receipt was not uploaded. Try again.'; end if;
  end if;
end;
$$;

alter table public.flights
  add column add_expense boolean not null default false,
  add column reimburse boolean not null default true,
  add column expense_id integer references public.expenses(id) on delete set null,
  add column bag_expense_id integer references public.expenses(id) on delete set null;
alter table public.hotels
  add column add_expense boolean not null default false,
  add column reimburse boolean not null default false,
  add column expense_id integer references public.expenses(id) on delete set null;

-- Snapshot: bookings gain "addExp", "reimb", and their expense ids ("exp", "bagExp").
alter function public.ops_snapshot() rename to ops_snapshot_v13;
alter function public.ops_snapshot_v13() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v13() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v13();
  if jsonb_typeof(snapshot->'flights') <> 'array' then return snapshot; end if;
  -- "travelExpenses": true tells the app this database supports Add to expenses.
  return snapshot || jsonb_build_object('travelExpenses', true,
    'flights', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('addExp', f.add_expense, 'reimb', f.reimburse, 'exp', f.expense_id, 'bagExp', f.bag_expense_id)
        from public.flights f where f.id = (x->>'id')::integer), '{}'::jsonb) order by n) from jsonb_array_elements(snapshot->'flights') with ordinality t(x, n)), '[]'::jsonb),
    'hotels', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('addExp', h.add_expense, 'reimb', h.reimburse, 'exp', h.expense_id)
        from public.hotels h where h.id = (x->>'id')::integer), '{}'::jsonb) order by n) from jsonb_array_elements(snapshot->'hotels') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Create, update, or remove one linked expense. Returns the expense id to keep (or null).
create function ops_private.travel_expense(current_id integer, want boolean, eid integer, owner integer, cat text, amount numeric,
  pay text, reimb boolean, place text, ref text, notes text, rp text, rt text, admin boolean) returns integer language plpgsql
security definer set search_path = '' as $$
declare x public.expenses; obj jsonb; amt text := to_char(amount, 'FM99990.00');
begin
  if current_id is not null then select * into x from public.expenses where id = current_id; end if;
  if not want or amount <= 0 then
    if x.id is not null then delete from public.expenses where id = x.id; end if;
    return null;
  end if;
  obj := jsonb_build_object('cat', cat, 'pay', pay, 'date', coalesce(x.spent_on, current_date)::text, 'amt', amt, 'notes', notes,
    'rp', coalesce(nullif(rp, ''), x.receipt_path), 'rt', case when nullif(rp, '') is not null then rt else x.receipt_type end);
  perform ops_private.check_expense(obj, owner);
  if x.id is null then
    insert into public.expenses(event_id, person_id, category, location, receipt_ref, spent_on, amount, payment, reimburse, notes, receipt_path, receipt_type)
      values(eid, owner, cat, left(place, 200), left(ref, 100), current_date, amount, pay, reimb, left(notes, 1000), obj->>'rp', obj->>'rt')
      returning id into x.id;
  else
    update public.expenses set category = cat, location = left(place, 200), receipt_ref = left(ref, 100), amount = travel_expense.amount,
        payment = pay, reimburse = reimb, notes = left(travel_expense.notes, 1000), receipt_path = obj->>'rp', receipt_type = obj->>'rt',
        approved = case when x.approved and x.amount <> travel_expense.amount then false else x.approved end,
        approved_at = case when x.approved and x.amount <> travel_expense.amount then null else x.approved_at end,
        approved_by = case when x.approved and x.amount <> travel_expense.amount then null else x.approved_by end,
        updated_at = now()
      where id = x.id;
  end if;
  return x.id;
end;
$$;
revoke all on function ops_private.travel_expense(integer, boolean, integer, integer, text, numeric, text, boolean, text, text, text, text, text, boolean) from public, anon, authenticated;

-- Commands: saveFlight / saveHotel take, in the booking object, "addExpense", "reimb", and the receipt "rp"/"rt"
-- (a flight with a bag fee also "rp2", a second copy of the receipt for the Baggage expense). A receipt is needed
-- only when an expense is first created or to replace it. Everything else goes to the previous command function.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v13;
alter function public.ops_command_v13(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v13(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare admin boolean; pid integer; o jsonb; eid integer; who integer; f public.flights; h public.hotels; result jsonb;
  locked boolean; want boolean; pay text; place text; air_id integer; bag_id integer; hotel_id integer; old_ids integer[];
begin
  admin := coalesce(ops_private.is_admin(), false);
  pid := ops_private.person_id();
  if action in ('editExpense', 'delExpense') and not admin and (
      exists(select 1 from public.flights where expense_id = (args->>0)::integer or bag_expense_id = (args->>0)::integer)
      or exists(select 1 from public.hotels where expense_id = (args->>0)::integer)) then
    raise exception 'This expense comes from your itinerary. Change it in My travel.' using errcode = '42501';
  end if;
  if action not in ('saveFlight', 'saveHotel', 'delFlight', 'delHotel') then
    return ops_private.ops_command_v13(action, args, expected_revision);
  end if;

  -- Find the booking as it is now, to check the approval lock and to tidy its expenses afterwards.
  if action = 'saveFlight' then
    select * into f from public.flights where event_id = (args->>0)::integer and person_id = case when admin then (args->>1)::integer else pid end;
  elsif action = 'delFlight' then select * into f from public.flights where id = (args->>0)::integer;
  elsif action = 'saveHotel' then
    select * into h from public.hotels where event_id = (args->>0)::integer and person_id = case when admin then (args->>1)::integer else pid end;
  else select * into h from public.hotels where id = (args->>0)::integer; end if;
  locked := exists(select 1 from public.expenses where approved and id in (f.expense_id, f.bag_expense_id, h.expense_id));
  o := case when action like 'save%' then args->2 else null end;
  if locked and not admin then
    if action like 'del%' then raise exception 'This booking''s expense has been approved, so it can''t be deleted. Ask an administrator.' using errcode = '42501'; end if;
    if (action = 'saveFlight' and (ops_private.travel_money(o->'cost', 'Flight cost') <> f.flight_cost or ops_private.travel_money(o->'bags', 'Bag fee') <> f.bag_fee
          or coalesce(o->>'paid', f.paid) <> f.paid or btrim(coalesce(o->>'ref', '')) <> f.receipt_ref or coalesce((o->>'addExpense')::boolean, false) <> f.add_expense
          or coalesce((o->>'reimb')::boolean, f.reimburse) <> f.reimburse or nullif(o->>'rp', '') is not null))
      or (action = 'saveHotel' and (ops_private.travel_money(o->'total', 'Total cost') <> h.total_cost or coalesce(o->>'paid', h.paid) <> h.paid
          or btrim(coalesce(o->>'ref', '')) <> h.receipt_ref or coalesce((o->>'addExpense')::boolean, false) <> h.add_expense
          or coalesce((o->>'reimb')::boolean, h.reimburse) <> h.reimburse or nullif(o->>'rp', '') is not null)) then
      raise exception 'The costs are locked because the expense was approved. You can still change flight and hotel details. Ask an administrator to change costs.' using errcode = '42501';
    end if;
  end if;

  result := ops_private.ops_command_v13(action, args, expected_revision);

  if action like 'del%' then
    -- The booking is gone; remove its expenses too.
    old_ids := array_remove(array[f.expense_id, f.bag_expense_id, h.expense_id], null);
    if cardinality(old_ids) > 0 then delete from public.expenses where id = any(old_ids); return public.ops_snapshot(); end if;
    return result;
  end if;

  want := coalesce((o->>'addExpense')::boolean, false);
  if action = 'saveFlight' then
    select * into f from public.flights where event_id = (args->>0)::integer and person_id = case when admin then (args->>1)::integer else pid end;
    pay := case when f.paid in ('corporate_amex', 'personal_card') then f.paid else 'personal_card' end;
    place := coalesce(nullif(concat_ws(' / ', nullif(f.in_carrier, ''), nullif(case when f.out_carrier <> f.in_carrier then f.out_carrier end, '')), ''), 'Airline');
    if want and f.paid in ('points', 'event') and f.bag_fee <= 0 then
      raise exception 'There''s nothing to add to expenses: the flight was paid with % and has no bag fee.', case f.paid when 'points' then 'points' else 'the event''s master bill' end;
    end if;
    if want and f.flight_cost <= 0 and f.bag_fee <= 0 then raise exception 'Enter the flight cost or bag fee to add it to expenses.'; end if;
    air_id := ops_private.travel_expense(f.expense_id, want and f.paid not in ('points', 'event'), f.event_id, f.person_id, 'airfare', f.flight_cost,
      pay, coalesce((o->>'reimb')::boolean, f.paid = 'personal_card'), place, f.receipt_ref,
      'Flight ' || concat_ws(' / ', nullif(concat_ws(' ', nullif(f.in_flight, ''), nullif(f.in_from || '→' || f.in_to, '→')), ''), nullif(concat_ws(' ', nullif(f.out_flight, ''), nullif(f.out_from || '→' || f.out_to, '→')), '')),
      o->>'rp', o->>'rt', admin);
    bag_id := ops_private.travel_expense(f.bag_expense_id, want, f.event_id, f.person_id, 'baggage', f.bag_fee,
      pay, coalesce((o->>'reimb')::boolean, f.paid = 'personal_card'), place, f.receipt_ref, 'Bag fee',
      coalesce(nullif(o->>'rp2', ''), case when air_id is null then o->>'rp' end), o->>'rt', admin);
    update public.flights set add_expense = want, reimburse = coalesce((o->>'reimb')::boolean, reimburse), expense_id = air_id, bag_expense_id = bag_id where id = f.id;
  else
    select * into h from public.hotels where event_id = (args->>0)::integer and person_id = case when admin then (args->>1)::integer else pid end;
    if want and h.paid in ('points', 'event') then
      raise exception 'There''s nothing to add to expenses: the hotel was paid with %.', case h.paid when 'points' then 'points' else 'the event''s master bill' end;
    end if;
    if want and h.total_cost <= 0 then raise exception 'Enter the total cost from the hotel folio to add it to expenses.'; end if;
    hotel_id := ops_private.travel_expense(h.expense_id, want, h.event_id, h.person_id, 'hotel', h.total_cost,
      case when h.paid in ('corporate_amex', 'personal_card') then h.paid else 'personal_card' end,
      coalesce((o->>'reimb')::boolean, h.paid = 'personal_card'), coalesce(nullif(h.hotel_name, ''), 'Hotel'), h.receipt_ref,
      'Hotel stay ' || to_char(h.check_in, 'Mon FMDD') || ' – ' || to_char(h.check_out, 'Mon FMDD') || ' (' || (h.check_out - h.check_in) || ' nights)'
        || case when h.confirmation <> '' then ', confirmation ' || h.confirmation else '' end,
      o->>'rp', o->>'rt', admin);
    update public.hotels set add_expense = want, reimburse = coalesce((o->>'reimb')::boolean, reimburse), expense_id = hotel_id where id = h.id;
  end if;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
