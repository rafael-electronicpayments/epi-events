-- 2026-10-23 owner request: departure pickup times and arrival/departure instructions.
--   When the hotel-to-airport transfer is Car service or Group shuttle, the booking has a pickup time. It defaults to
--   3 hours before the departing flight (4 hours for an international flight), rounded down to the hour so people on
--   nearby flights share a shuttle, and moves with the flight. Admins can set a different time (kept until they reset
--   it). The traveler is told when the pickup time is set or changes, and gets an in-app notice and a push 30 minutes
--   before pickup. Wall-clock times in the event's time zone, like the flights.
--   Each event also has Arrival and Departure instructions (formatted text, admins edit). People see the Arrival card
--   only if their airport-to-hotel transfer is a car or shuttle, and the Departure card only if their hotel-to-airport
--   transfer is.
-- Run exactly once (it renames functions).

alter table public.flights add column out_intl boolean not null default false;
alter table public.hotels
  add column out_pickup timestamp,
  add column pickup_manual boolean not null default false;
alter table public.events
  add column arrival_info text not null default '' check (length(arrival_info) <= 20000),
  add column departure_info text not null default '' check (length(departure_info) <= 20000);
alter table public.push_outbox add column noted boolean not null default false;

do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.push_outbox'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table public.push_outbox drop constraint %I', c); end if;
  alter table public.push_outbox add constraint push_outbox_kind_check check (kind in ('assignment', 'reminder', 'test', 'travel', 'pickup'));
end;
$$;

-- The automatic pickup: departing flight minus 3 hours (4 if international), rounded down to the hour.
create function ops_private.pickup_default(eid integer, pid integer) returns timestamp language sql stable
security definer set search_path = '' as $$
  select date_trunc('hour', f.out_depart - case when f.out_intl then interval '4 hours' else interval '3 hours' end)
  from public.flights f where f.event_id = eid and f.person_id = pid and f.out_depart is not null;
$$;

-- Hotels keep their pickup in step: none for own arrangement, automatic unless an admin set it.
create function ops_private.hotel_pickup() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if new.transfer_out = 'own' then
    new.out_pickup := null; new.pickup_manual := false;
  elsif not new.pickup_manual or new.out_pickup is null then
    new.pickup_manual := false;
    new.out_pickup := ops_private.pickup_default(new.event_id, new.person_id);
  end if;
  return new;
end;
$$;
create trigger hotels_pickup before insert or update on public.hotels
  for each row execute function ops_private.hotel_pickup();

-- A changed, added, or removed departing flight moves the automatic pickup.
create function ops_private.flight_pickup() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    update public.hotels set out_pickup = out_pickup
      where event_id = old.event_id and person_id = old.person_id and transfer_out <> 'own' and not pickup_manual;
  end if;
  if tg_op <> 'DELETE' then
    update public.hotels set out_pickup = out_pickup
      where event_id = new.event_id and person_id = new.person_id and transfer_out <> 'own' and not pickup_manual;
  end if;
  return null;
end;
$$;
create trigger flights_pickup after insert or delete or update of out_depart, out_intl on public.flights
  for each row execute function ops_private.flight_pickup();

-- e.g. "Pickup 1:00 PM at Wyndham Rio Mar. Flight B6 1004 departs 4:00 PM. GSI, main entrance."
create function ops_private.pickup_text(h public.hotels, f public.flights) returns text language sql stable
set search_path = '' as $$
  select left('Pickup ' || to_char(h.out_pickup, 'FMHH12:MI AM') || ' at ' || coalesce(nullif(h.hotel_name, ''), 'the hotel') || '.'
    || case when f.out_depart is not null then ' Flight ' || coalesce(nullif(f.out_flight, '') || ' ', '') || 'departs ' || to_char(f.out_depart, 'FMHH12:MI AM') || '.' else '' end
    || case when h.transfer_notes <> '' then ' ' || h.transfer_notes else '' end, 500);
$$;

-- Replace the person's pending 30-minute pickup reminder for an event (none if not needed or too late).
create function ops_private.pickup_queue(eid integer, pid integer) returns void language plpgsql
security definer set search_path = '' as $$
declare h public.hotels; e public.events; f public.flights; due timestamptz;
begin
  delete from public.push_outbox where kind = 'pickup' and person_id = pid and event_id = eid and status = 'pending';
  select * into h from public.hotels where event_id = eid and person_id = pid;
  if h.id is null or h.transfer_out = 'own' or h.out_pickup is null then return; end if;
  select * into e from public.events where id = eid;
  if e.id is null or e.closed then return; end if;
  if not exists(select 1 from public.people where id = pid and not archived) then return; end if;
  due := (h.out_pickup at time zone e.time_zone) - interval '30 minutes';
  if due <= now() then return; end if;
  select * into f from public.flights where event_id = eid and person_id = pid;
  insert into public.push_outbox(person_id, kind, event_id, title, body, due_at, next_attempt)
    values(pid, 'pickup', eid, case when h.transfer_out = 'car' then 'Car service in 30 minutes' else 'Shuttle leaves in 30 minutes' end,
      ops_private.pickup_text(h, f), due, due);
end;
$$;

-- An event's time zone change or reopening recomputes its pickup reminders.
create function ops_private.pickup_on_event() returns trigger language plpgsql
security definer set search_path = '' as $$
declare r record;
begin
  if new.time_zone is distinct from old.time_zone or new.closed is distinct from old.closed then
    for r in select person_id from public.hotels where event_id = new.id and transfer_out <> 'own' loop
      perform ops_private.pickup_queue(new.id, r.person_id);
    end loop;
  end if;
  return null;
end;
$$;
create trigger events_pickup after update of time_zone, closed on public.events
  for each row execute function ops_private.pickup_on_event();

revoke all on function ops_private.pickup_default(integer, integer), ops_private.hotel_pickup(), ops_private.flight_pickup(),
  ops_private.pickup_text(public.hotels, public.flights), ops_private.pickup_queue(integer, integer), ops_private.pickup_on_event()
  from public, anon, authenticated;

-- Sender: when a pickup reminder comes due, the person also gets an in-app notice (once, even with no devices),
-- a reminder is dropped once the pickup time has passed, and pickup pushes expire after 30 minutes.
alter function public.push_claim(integer) rename to push_claim_v1;
alter function public.push_claim_v1(integer) set schema ops_private;
revoke all on function ops_private.push_claim_v1(integer) from public, anon, authenticated;

create function public.push_claim(max_rows integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claimed jsonb;
begin
  update public.push_outbox set status = 'skipped', last_error = 'Too late: the pickup time has passed'
    where kind = 'pickup' and status in ('pending', 'sending') and due_at + interval '30 minutes' <= now();
  with due as (
    update public.push_outbox o set noted = true
      where o.kind = 'pickup' and o.status = 'pending' and not o.noted and o.due_at <= now()
        and exists(select 1 from public.people p where p.id = o.person_id and not p.archived)
        and exists(select 1 from public.events e where e.id = o.event_id and not e.closed)
      returning o.person_id, o.title, o.body)
  insert into public.notifications(person_id, message) select person_id, title || '. ' || body from due;
  claimed := ops_private.push_claim_v1(max_rows);
  return coalesce((select jsonb_agg(case when c->>'kind' = 'pickup' then jsonb_set(c, '{ttl}', '1800') else c end order by n)
    from jsonb_array_elements(claimed) with ordinality t(c, n)), '[]'::jsonb);
end;
$$;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
do $$
begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.push_claim(integer) to service_role';
  end if;
end;
$$;

-- Snapshot: "travelInfo": true; each event's "arrInfo"/"depInfo" (admins always; others only for the way their
-- transfer is a car or shuttle); flights "intl"; hotels "pickup" and "pickupManual".
alter function public.ops_snapshot() rename to ops_snapshot_v14;
alter function public.ops_snapshot_v14() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v14() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v14();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object('travelInfo', true,
    'events', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object(
        'arrInfo', case when admin or (not e.closed and exists(select 1 from public.hotels h where h.event_id = e.id and h.person_id = pid and h.transfer_in <> 'own')) then e.arrival_info else '' end,
        'depInfo', case when admin or (not e.closed and exists(select 1 from public.hotels h where h.event_id = e.id and h.person_id = pid and h.transfer_out <> 'own')) then e.departure_info else '' end)
        from public.events e where e.id = (x->>'id')::integer), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'events') with ordinality t(x, n)), '[]'::jsonb),
    'flights', coalesce((select jsonb_agg(x || jsonb_build_object('intl', coalesce((select f.out_intl from public.flights f where f.id = (x->>'id')::integer), false)) order by n)
      from jsonb_array_elements(snapshot->'flights') with ordinality t(x, n)), '[]'::jsonb),
    'hotels', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('pickup', to_char(h.out_pickup, 'YYYY-MM-DD"T"HH24:MI'), 'pickupManual', h.pickup_manual)
        from public.hotels h where h.id = (x->>'id')::integer), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'hotels') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   setTravelInfo [eventId, {arr, dep}]   (admins) formatted HTML, sanitized by the app; 20,000 characters each at most
--   saveFlight: the flight object also takes "intl" (international departing flight: 4-hour pickup).
--   saveHotel (admins): "pickupManual" true with "pickup" ("YYYY-MM-DDTHH:MM") sets the pickup time; false resets it.
--   After any booking change the pickup reminder is requeued, and the traveler is told if the pickup time changed.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v14;
alter function public.ops_command_v14(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v14(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; pid integer; eid integer; who integer; o jsonb; ev public.events; h public.hotels;
  before_pickup timestamp; pickup timestamp; arr text; dep text; result jsonb;
begin
  admin := coalesce(ops_private.is_admin(), false);
  if action = 'setTravelInfo' then
    if not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    select revision into v from public.ops_state where id = 1 for update;
    if expected_revision is null or v <> expected_revision then
      raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
    end if;
    eid := (args->>0)::integer; o := args->1;
    select * into ev from public.events where id = eid;
    if ev.id is null then raise exception 'Choose an event.'; end if;
    if jsonb_typeof(o) <> 'object' then raise exception 'Invalid instructions.'; end if;
    arr := coalesce(o->>'arr', ''); dep := coalesce(o->>'dep', '');
    if length(arr) > 20000 or length(dep) > 20000 then
      raise exception 'The instructions are too long. Each box can hold up to 20,000 characters, including formatting.';
    end if;
    update public.events set arrival_info = arr, departure_info = dep where id = eid;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('event_id', eid, 'name', ev.name));
    update public.ops_state set revision = revision + 1 where id = 1;
    return public.ops_snapshot();
  end if;
  if action not in ('saveFlight', 'delFlight', 'saveHotel', 'delHotel') then
    return ops_private.ops_command_v14(action, args, expected_revision);
  end if;

  pid := ops_private.person_id();
  if action in ('saveFlight', 'saveHotel') then
    eid := (args->>0)::integer; who := case when admin then (args->>1)::integer else pid end; o := args->2;
  elsif action = 'delFlight' then
    select event_id, person_id into eid, who from public.flights where id = (args->>0)::integer;
  else
    select event_id, person_id into eid, who from public.hotels where id = (args->>0)::integer;
  end if;
  if action = 'saveHotel' and admin and jsonb_typeof(o) = 'object' and coalesce((o->>'pickupManual')::boolean, false)
    and coalesce(o->>'tOut', 'own') <> 'own' then
    pickup := ops_private.travel_time(o->'pickup', 'pickup');
    if pickup is null then raise exception 'Enter the pickup date and time.'; end if;
  end if;
  select out_pickup into before_pickup from public.hotels where event_id = eid and person_id = who;

  result := ops_private.ops_command_v14(action, args, expected_revision);

  if action = 'saveFlight' and jsonb_typeof(o) = 'object' and o ? 'intl' then
    update public.flights set out_intl = coalesce((o->>'intl')::boolean, false)
      where event_id = eid and person_id = who and out_intl is distinct from coalesce((o->>'intl')::boolean, false);
  elsif action = 'saveHotel' and admin and jsonb_typeof(o) = 'object' and o ? 'pickupManual' then
    if pickup is not null then
      update public.hotels set out_pickup = pickup, pickup_manual = true where event_id = eid and person_id = who and transfer_out <> 'own';
    else
      update public.hotels set pickup_manual = false where event_id = eid and person_id = who and pickup_manual;
    end if;
  end if;

  if eid is not null and who is not null then
    perform ops_private.pickup_queue(eid, who);
    select * into h from public.hotels where event_id = eid and person_id = who;
    select * into ev from public.events where id = eid;
    if h.id is not null and h.transfer_out <> 'own' and h.out_pickup is not null and h.out_pickup is distinct from before_pickup and not ev.closed then
      perform ops_private.travel_notice(who, eid, 'Your ' || case when h.transfer_out = 'car' then 'car service' else 'shuttle' end
        || ' pickup for ' || ev.name || ' is ' || to_char(h.out_pickup, 'FMDy, Mon FMDD, FMHH12:MI AM') || ' at the hotel. You''ll get a reminder 30 minutes before.');
    end if;
  end if;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
