-- 2026-10-26 owner request: import the flights manifest spreadsheet into Itineraries.
--   Flight numbers can hold every leg of a connection ("UA 1889 & UA 1339"), up to 60 characters.
--   importFlights adds or updates many people's flights at once after the admin reviews the matches in the app.
--   New flights: booked by the traveler, paid by personal card (they add cost and receipt themselves if they want
--   reimbursement). Existing flights: carriers, flight numbers, dates, times, and International are replaced; costs,
--   receipts, and expenses are kept. "VIP / solo rider" rows set the hotel transfer to Car service both ways when the
--   person has a hotel booking. Travelers are told when their flight is added or changes. Run exactly once.

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.flights'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%in_flight%' or pg_get_constraintdef(oid) like '%out_flight%') loop
    execute format('alter table public.flights drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.flights
  add constraint flights_in_flight_check check (length(in_flight) <= 60),
  add constraint flights_out_flight_check check (length(out_flight) <= 60);

-- Snapshot: "flightImport": true (the app shows Import flights only on databases with this script).
alter function public.ops_snapshot() rename to ops_snapshot_v17;
alter function public.ops_snapshot_v17() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v17() from public, anon, authenticated;
create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
begin
  return ops_private.ops_snapshot_v17() || jsonb_build_object('flightImport', true);
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   importFlights [eventId, rows]   admins; up to 500 rows:
--     {e, inCarrier, inFlight, inArrive, outCarrier, outFlight, outDepart, intl, vip}
--     times "YYYY-MM-DDTHH:MM" in the event's time zone (either leg may be empty, not both).
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v17;
alter function public.ops_command_v17(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v17(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; ev public.events; r jsonb; who integer; arrive timestamp; depart timestamp; old public.flights; f public.flights;
  n_new integer := 0; n_upd integer := 0; n_car integer := 0; pname text;
begin
  if action <> 'importFlights' then return ops_private.ops_command_v17(action, args, expected_revision); end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  eid := (args->>0)::integer;
  select * into ev from public.events where id = eid;
  if ev.id is null then raise exception 'Choose an event.'; end if;
  if jsonb_typeof(args->1) <> 'array' or jsonb_array_length(args->1) > 500 then raise exception 'Invalid flight list.'; end if;

  for r in select * from jsonb_array_elements(args->1) loop
    who := (r->>'e')::integer;
    select name into pname from public.people where id = who and not archived;
    if pname is null then raise exception 'Choose an active person for each row.'; end if;
    arrive := ops_private.travel_time(r->'inArrive', 'arrival');
    depart := ops_private.travel_time(r->'outDepart', 'departure');
    if arrive is null and depart is null then raise exception 'Every row needs an arrival or departure time (%).', pname; end if;
    if arrive is not null and depart is not null and depart <= arrive then raise exception 'The departure must be after the arrival (%).', pname; end if;
    if length(coalesce(r->>'inFlight', '')) > 60 or length(coalesce(r->>'outFlight', '')) > 60
      or length(coalesce(r->>'inCarrier', '')) > 60 or length(coalesce(r->>'outCarrier', '')) > 60 then
      raise exception 'A flight number or carrier is too long (%).', pname;
    end if;
    select * into old from public.flights where event_id = eid and person_id = who;
    insert into public.flights(event_id, person_id, in_carrier, in_flight, in_arrive, out_carrier, out_flight, out_depart, out_intl,
        booked_by, booked_event, paid, created_by)
      values(eid, who, btrim(coalesce(r->>'inCarrier', '')), upper(btrim(coalesce(r->>'inFlight', ''))), arrive,
        btrim(coalesce(r->>'outCarrier', '')), upper(btrim(coalesce(r->>'outFlight', ''))), depart, coalesce((r->>'intl')::boolean, false),
        who, false, 'personal_card', auth.uid())
      on conflict (event_id, person_id) do update set in_carrier = excluded.in_carrier, in_flight = excluded.in_flight,
        in_arrive = excluded.in_arrive, out_carrier = excluded.out_carrier, out_flight = excluded.out_flight,
        out_depart = excluded.out_depart, out_intl = excluded.out_intl, updated_at = now()
        where (public.flights.in_carrier, public.flights.in_flight, public.flights.in_arrive, public.flights.out_carrier,
               public.flights.out_flight, public.flights.out_depart, public.flights.out_intl)
          is distinct from (excluded.in_carrier, excluded.in_flight, excluded.in_arrive, excluded.out_carrier,
               excluded.out_flight, excluded.out_depart, excluded.out_intl);
    select * into f from public.flights where event_id = eid and person_id = who;
    if coalesce((r->>'vip')::boolean, false) then
      update public.hotels set transfer_in = 'car', transfer_out = 'car', updated_at = now()
        where event_id = eid and person_id = who and (transfer_in, transfer_out) is distinct from ('car', 'car');
      if found then n_car := n_car + 1; end if;
    end if;
    perform ops_private.pickup_queue(eid, who);
    if old.id is null then
      n_new := n_new + 1;
      if not ev.closed then perform ops_private.travel_notice(who, eid, 'Your flight for ' || ev.name || ' has been added. See My travel.'); end if;
    elsif (old.in_carrier, old.in_flight, old.in_arrive, old.out_carrier, old.out_flight, old.out_depart)
        is distinct from (f.in_carrier, f.in_flight, f.in_arrive, f.out_carrier, f.out_flight, f.out_depart) then
      n_upd := n_upd + 1;
      if not ev.closed then perform ops_private.travel_notice(who, eid, 'Your flight for ' || ev.name || ' was updated. Check My travel.'); end if;
    end if;
  end loop;
  insert into public.activity_log(actor_id, action, details)
    values(auth.uid(), action, jsonb_build_object('event_id', eid, 'name', ev.name, 'added', n_new, 'updated', n_upd, 'car_service', n_car));
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
