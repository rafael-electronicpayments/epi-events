-- 2026-10-23 owner request: Itineraries, part 1 (bookings). Each person's flight and hotel for an event.
--   Admins enter and edit anyone's bookings. People ("staff" = Admin, Staff, Contractor) may enter their own flight
--   and/or hotel only when the event allows it (two switches per event), and may edit only bookings they entered,
--   only while that switch is on. Admins choose the airport transfer each way (car service, group shuttle, own
--   arrangement) with optional details. Times are wall-clock times in the event's time zone.
--   When an admin adds, changes, or removes someone's booking, that person gets an in-app notice and a push.
--   Confirmation numbers and costs are visible only to the traveler and admins; closed events hide them.
-- Part 2 (later) adds the expense link, approval lock, and report. Run exactly once.

alter table public.events
  add column staff_flights boolean not null default false,
  add column staff_hotels boolean not null default false;

create table public.flights (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  in_carrier text not null default '' check (length(in_carrier) <= 60),
  in_flight text not null default '' check (length(in_flight) <= 12),
  in_from text not null default '' check (in_from ~ '^([A-Z]{3})?$'),
  in_to text not null default '' check (in_to ~ '^([A-Z]{3})?$'),
  in_arrive timestamp,
  out_carrier text not null default '' check (length(out_carrier) <= 60),
  out_flight text not null default '' check (length(out_flight) <= 12),
  out_from text not null default '' check (out_from ~ '^([A-Z]{3})?$'),
  out_to text not null default '' check (out_to ~ '^([A-Z]{3})?$'),
  out_depart timestamp,
  booked_by integer references public.people(id) on delete set null,  -- null with booked_event = true means "Event"
  booked_event boolean not null default false,
  paid text not null default 'personal_card' check (paid in ('event', 'corporate_amex', 'points', 'personal_card')),
  receipt_ref text not null default '' check (length(receipt_ref) <= 100),
  flight_cost numeric(10, 2) not null default 0 check (flight_cost >= 0 and flight_cost < 100000),
  bag_fee numeric(10, 2) not null default 0 check (bag_fee >= 0 and bag_fee < 100000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, person_id)
);

create table public.hotels (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  hotel_name text not null default '' check (length(hotel_name) <= 200),
  confirmation text not null default '' check (length(confirmation) <= 60),
  check_in date not null,
  check_out date not null,
  booked_by integer references public.people(id) on delete set null,
  booked_event boolean not null default false,
  paid text not null default 'event' check (paid in ('event', 'corporate_amex', 'points', 'personal_card')),
  receipt_ref text not null default '' check (length(receipt_ref) <= 100),
  nightly_cost numeric(10, 2) not null default 0 check (nightly_cost >= 0 and nightly_cost < 100000),
  room_charges numeric(10, 2) not null default 0 check (room_charges >= 0 and room_charges < 100000),
  total_cost numeric(10, 2) not null default 0 check (total_cost >= 0 and total_cost < 1000000),
  transfer_in text not null default 'own' check (transfer_in in ('car', 'shuttle', 'own')),
  transfer_out text not null default 'own' check (transfer_out in ('car', 'shuttle', 'own')),
  transfer_notes text not null default '' check (length(transfer_notes) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, person_id),
  check (check_out > check_in)
);

alter table public.flights enable row level security;
alter table public.hotels enable row level security;
create policy flights_read on public.flights for select to authenticated
  using (ops_private.is_admin() or (person_id = ops_private.person_id() and ops_private.event_open(event_id)));
create policy hotels_read on public.hotels for select to authenticated
  using (ops_private.is_admin() or (person_id = ops_private.person_id() and ops_private.event_open(event_id)));
revoke all on public.flights, public.hotels from anon, authenticated;
grant select on public.flights, public.hotels to authenticated;

-- Travel notices go out as pushes too.
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.push_outbox'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table public.push_outbox drop constraint %I', c); end if;
  alter table public.push_outbox add constraint push_outbox_kind_check check (kind in ('assignment', 'reminder', 'test', 'travel'));
end;
$$;

create function ops_private.travel_notice(pid integer, eid integer, msg text) returns void language plpgsql
security definer set search_path = '' as $$
begin
  insert into public.notifications(person_id, message) values(pid, msg);
  if to_regclass('public.push_subscriptions') is not null and exists(select 1 from public.push_subscriptions where person_id = pid) then
    insert into public.push_outbox(person_id, kind, event_id, title, body) values(pid, 'travel', eid, 'Travel updated', msg);
  end if;
end;
$$;
revoke all on function ops_private.travel_notice(integer, integer, text) from public, anon, authenticated;

-- Snapshot: everything from before, plus "itineraries": true, each event's "staffFlights"/"staffHotels", and
-- "flights"/"hotels": admins get everyone's; others get only their own in open events. "mine" marks a booking
-- the signed-in person entered (they may edit it while the event allows).
alter function public.ops_snapshot() rename to ops_snapshot_v12;
alter function public.ops_snapshot_v12() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v12() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer; me uuid;
begin
  snapshot := ops_private.ops_snapshot_v12();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  me := auth.uid();
  return snapshot || jsonb_build_object('itineraries', true,
    'events', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('staffFlights', e.staff_flights, 'staffHotels', e.staff_hotels)
        from public.events e where e.id = (x->>'id')::integer), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'events') with ordinality t(x, n)), '[]'::jsonb),
    'flights', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ev', f.event_id, 'e', f.person_id,
        'inCarrier', f.in_carrier, 'inFlight', f.in_flight, 'inFrom', f.in_from, 'inTo', f.in_to, 'inArrive', to_char(f.in_arrive, 'YYYY-MM-DD"T"HH24:MI'),
        'outCarrier', f.out_carrier, 'outFlight', f.out_flight, 'outFrom', f.out_from, 'outTo', f.out_to, 'outDepart', to_char(f.out_depart, 'YYYY-MM-DD"T"HH24:MI'),
        'by', f.booked_by, 'byEvent', f.booked_event, 'paid', f.paid, 'ref', f.receipt_ref, 'cost', f.flight_cost, 'bags', f.bag_fee,
        'mine', f.created_by = me) order by f.event_id, f.in_arrive nulls last, f.id)
      from public.flights f join public.people p on p.id = f.person_id
      where (admin or (f.person_id = pid and ops_private.event_open(f.event_id))) and (admin or not p.archived)), '[]'::jsonb),
    'hotels', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'ev', h.event_id, 'e', h.person_id,
        'name', h.hotel_name, 'conf', h.confirmation, 'in', h.check_in, 'out', h.check_out,
        'by', h.booked_by, 'byEvent', h.booked_event, 'paid', h.paid, 'ref', h.receipt_ref,
        'nightly', h.nightly_cost, 'charges', h.room_charges, 'total', h.total_cost,
        'tIn', h.transfer_in, 'tOut', h.transfer_out, 'tNotes', h.transfer_notes, 'mine', h.created_by = me) order by h.event_id, h.check_in, h.id)
      from public.hotels h join public.people p on p.id = h.person_id
      where (admin or (h.person_id = pid and ops_private.event_open(h.event_id))) and (admin or not p.archived)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   saveFlight [eventId, personId, flight]   delFlight [flightId]
--   saveHotel  [eventId, personId, hotel]    delHotel  [hotelId]
--     flight = {inCarrier, inFlight, inFrom, inTo, inArrive, outCarrier, outFlight, outFrom, outTo, outDepart,
--               by, byEvent, paid, ref, cost, bags}
--     hotel  = {name, conf, in, out, by, byEvent, paid, ref, nightly, charges, total, tIn, tOut, tNotes}
--     Non-admins: personId is ignored (always themselves); transfer fields are admin-only.
--   addEvent / editEvent also take staffFlights / staffHotels (admins).
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v12;
alter function public.ops_command_v12(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v12(text, jsonb, integer) from public, anon, authenticated;

create function ops_private.travel_money(v jsonb, label text) returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if v is null or jsonb_typeof(v) = 'null' or btrim(v #>> '{}') = '' then return 0; end if;
  if (v #>> '{}') !~ '^\d{1,6}(\.\d{1,2})?$' then raise exception '% must be an amount up to two decimals.', label; end if;
  return (v #>> '{}')::numeric;
end;
$$;

create function ops_private.travel_time(v jsonb, label text) returns timestamp language plpgsql immutable set search_path = '' as $$
begin
  if v is null or jsonb_typeof(v) = 'null' or btrim(v #>> '{}') = '' then return null; end if;
  if (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise exception 'Enter the % date and time.', label; end if;
  return (v #>> '{}')::timestamp;
end;
$$;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; pid integer; eid integer; target integer; o jsonb; ev public.events; pname text;
  f public.flights; h public.hotels; existing_by uuid; existing_id integer; who integer; arrive timestamp; depart timestamp;
  cin date; cout date; result jsonb; flags boolean := false; tin text; tout text; tnotes text; noun text;
begin
  if action in ('addEvent', 'editEvent') then
    o := case when action = 'addEvent' then args->0 else args->1 end;
    flags := jsonb_typeof(o) = 'object' and (o ? 'staffFlights' or o ? 'staffHotels');
    result := ops_private.ops_command_v12(action, args, expected_revision);
    if flags then
      target := case when action = 'addEvent' then (select max(id) from public.events) else (args->>0)::integer end;
      update public.events set
          staff_flights = case when o ? 'staffFlights' then coalesce((o->>'staffFlights')::boolean, false) else staff_flights end,
          staff_hotels = case when o ? 'staffHotels' then coalesce((o->>'staffHotels')::boolean, false) else staff_hotels end
        where id = target;
      result := public.ops_snapshot();
    end if;
    return result;
  end if;
  if action not in ('saveFlight', 'delFlight', 'saveHotel', 'delHotel') then
    return ops_private.ops_command_v12(action, args, expected_revision);
  end if;

  admin := coalesce(ops_private.is_admin(), false);
  pid := ops_private.person_id();
  if not admin and pid is null then raise exception 'Only people on the roster can enter travel.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  noun := case when action like '%Flight' then 'flight' else 'hotel' end;

  if action in ('saveFlight', 'saveHotel') then
    eid := (args->>0)::integer;
    who := case when admin then (args->>1)::integer else pid end;
    o := args->2;
    if jsonb_typeof(o) <> 'object' then raise exception 'Invalid % details.', noun; end if;
  else
    if action = 'delFlight' then select event_id, person_id into eid, who from public.flights where id = (args->>0)::integer;
    else select event_id, person_id into eid, who from public.hotels where id = (args->>0)::integer; end if;
    if eid is null then raise exception 'This % booking no longer exists.', noun; end if;
  end if;
  select * into ev from public.events where id = eid;
  if ev.id is null then raise exception 'Choose an event.'; end if;
  select name into pname from public.people where id = who and not archived;
  if pname is null then raise exception 'Choose an active person.'; end if;

  if action like '%Flight' then
    select id, created_by into existing_id, existing_by from public.flights where event_id = eid and person_id = who;
  else
    select id, created_by into existing_id, existing_by from public.hotels where event_id = eid and person_id = who;
  end if;
  if not admin then
    if who <> pid then raise exception 'Access denied.' using errcode = '42501'; end if;
    if ev.closed then raise exception 'This event is closed.' using errcode = '42501'; end if;
    if (noun = 'flight' and not ev.staff_flights) or (noun = 'hotel' and not ev.staff_hotels) then
      raise exception 'Entering your own % is turned off for this event. Ask an administrator.', noun using errcode = '42501';
    end if;
    if existing_id is not null and existing_by is distinct from auth.uid() then
      raise exception 'An administrator booked this % for you, so it can''t be changed here. Ask an administrator.', noun using errcode = '42501';
    end if;
  end if;

  if action = 'saveFlight' then
    arrive := ops_private.travel_time(o->'inArrive', 'arrival');
    depart := ops_private.travel_time(o->'outDepart', 'departure');
    if arrive is null and depart is null and btrim(coalesce(o->>'inFlight', '')) = '' and btrim(coalesce(o->>'outFlight', '')) = '' then
      raise exception 'Enter the arriving or departing flight.';
    end if;
    if arrive is not null and depart is not null and depart <= arrive then raise exception 'The departing flight must be after the arrival.'; end if;
    if coalesce(o->>'paid', 'personal_card') not in ('event', 'corporate_amex', 'points', 'personal_card') then raise exception 'Choose how it was paid.'; end if;
    if not coalesce((o->>'byEvent')::boolean, false) and jsonb_typeof(o->'by') = 'number'
      and not exists(select 1 from public.people where id = (o->>'by')::integer and not archived) then raise exception 'Choose who booked it.'; end if;
    insert into public.flights as t(event_id, person_id, in_carrier, in_flight, in_from, in_to, in_arrive, out_carrier, out_flight, out_from, out_to, out_depart,
        booked_by, booked_event, paid, receipt_ref, flight_cost, bag_fee, created_by)
      values(eid, who, btrim(coalesce(o->>'inCarrier', '')), upper(btrim(coalesce(o->>'inFlight', ''))), upper(btrim(coalesce(o->>'inFrom', ''))), upper(btrim(coalesce(o->>'inTo', ''))), arrive,
        btrim(coalesce(o->>'outCarrier', '')), upper(btrim(coalesce(o->>'outFlight', ''))), upper(btrim(coalesce(o->>'outFrom', ''))), upper(btrim(coalesce(o->>'outTo', ''))), depart,
        case when coalesce((o->>'byEvent')::boolean, false) then null when jsonb_typeof(o->'by') = 'number' then (o->>'by')::integer else coalesce(pid, who) end,
        coalesce((o->>'byEvent')::boolean, false), coalesce(o->>'paid', 'personal_card'), btrim(coalesce(o->>'ref', '')),
        ops_private.travel_money(o->'cost', 'Flight cost'), ops_private.travel_money(o->'bags', 'Bag fee'), auth.uid())
      on conflict (event_id, person_id) do update set in_carrier = excluded.in_carrier, in_flight = excluded.in_flight, in_from = excluded.in_from,
        in_to = excluded.in_to, in_arrive = excluded.in_arrive, out_carrier = excluded.out_carrier, out_flight = excluded.out_flight,
        out_from = excluded.out_from, out_to = excluded.out_to, out_depart = excluded.out_depart, booked_by = excluded.booked_by,
        booked_event = excluded.booked_event, paid = excluded.paid, receipt_ref = excluded.receipt_ref, flight_cost = excluded.flight_cost,
        bag_fee = excluded.bag_fee, updated_at = now();
  elsif action = 'saveHotel' then
    if coalesce(o->>'in', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(o->>'out', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the hotel arrival and departure dates.'; end if;
    cin := (o->>'in')::date; cout := (o->>'out')::date;
    if cout <= cin then raise exception 'The hotel departure date must be after the arrival date.'; end if;
    if coalesce(o->>'paid', 'event') not in ('event', 'corporate_amex', 'points', 'personal_card') then raise exception 'Choose how it was paid.'; end if;
    if not coalesce((o->>'byEvent')::boolean, false) and jsonb_typeof(o->'by') = 'number'
      and not exists(select 1 from public.people where id = (o->>'by')::integer and not archived) then raise exception 'Choose who booked it.'; end if;
    if admin then
      tin := coalesce(o->>'tIn', 'own'); tout := coalesce(o->>'tOut', 'own'); tnotes := btrim(coalesce(o->>'tNotes', ''));
      if tin not in ('car', 'shuttle', 'own') or tout not in ('car', 'shuttle', 'own') then raise exception 'Choose the airport transfer.'; end if;
      if length(tnotes) > 300 then raise exception 'Transfer details can be up to 300 characters.'; end if;
    else
      select transfer_in, transfer_out, transfer_notes into tin, tout, tnotes from public.hotels where id = existing_id;
      tin := coalesce(tin, 'own'); tout := coalesce(tout, 'own'); tnotes := coalesce(tnotes, '');
    end if;
    insert into public.hotels as t(event_id, person_id, hotel_name, confirmation, check_in, check_out, booked_by, booked_event, paid, receipt_ref,
        nightly_cost, room_charges, total_cost, transfer_in, transfer_out, transfer_notes, created_by)
      values(eid, who, btrim(coalesce(nullif(btrim(coalesce(o->>'name', '')), ''), ev.venue, '')), btrim(coalesce(o->>'conf', '')), cin, cout,
        case when coalesce((o->>'byEvent')::boolean, false) then null when jsonb_typeof(o->'by') = 'number' then (o->>'by')::integer else coalesce(pid, who) end,
        coalesce((o->>'byEvent')::boolean, false), coalesce(o->>'paid', 'event'), btrim(coalesce(o->>'ref', '')),
        ops_private.travel_money(o->'nightly', 'Nightly cost'), ops_private.travel_money(o->'charges', 'Room charges'),
        ops_private.travel_money(o->'total', 'Total cost'), tin, tout, tnotes, auth.uid())
      on conflict (event_id, person_id) do update set hotel_name = excluded.hotel_name, confirmation = excluded.confirmation,
        check_in = excluded.check_in, check_out = excluded.check_out, booked_by = excluded.booked_by, booked_event = excluded.booked_event,
        paid = excluded.paid, receipt_ref = excluded.receipt_ref, nightly_cost = excluded.nightly_cost, room_charges = excluded.room_charges,
        total_cost = excluded.total_cost, transfer_in = excluded.transfer_in, transfer_out = excluded.transfer_out,
        transfer_notes = excluded.transfer_notes, updated_at = now();
  elsif action = 'delFlight' then
    delete from public.flights where id = (args->>0)::integer;
  else
    delete from public.hotels where id = (args->>0)::integer;
  end if;

  -- Tell the traveler when someone else changed their travel.
  if pid is distinct from who then
    perform ops_private.travel_notice(who, eid, case
      when action like 'del%' then 'Your ' || noun || ' booking for ' || ev.name || ' was removed. Check My travel.'
      when existing_id is null then 'Your ' || noun || ' for ' || ev.name || ' has been booked. See My travel for the details.'
      else 'Your ' || noun || ' booking for ' || ev.name || ' was updated. Check My travel for the changes.' end);
  end if;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('event_id', eid, 'person_id', who, 'name', pname));
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
