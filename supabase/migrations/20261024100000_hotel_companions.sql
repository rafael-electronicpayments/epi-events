-- 2026-10-23 owner request: accompanying person on hotel bookings, and importing the venue hotel's rooming list.
--   A hotel booking can name an accompanying person (we don't record the relationship). When an admin links that
--   name to someone in People, both of them get the reservation: the other person gets a shared copy with the same
--   hotel, confirmation #, and dates, each naming the other as accompanying. Editing those details on either one
--   changes both. Costs, how paid, and Add to expenses stay only on the booking of the person named on the
--   reservation (the "primary"), so nothing is claimed twice. Airport transfers and pickups stay per person.
--   Removing the primary booking removes the shared copy; removing the copy just unlinks it.
--   importHotels adds or updates many bookings at once (confirmation #, dates, accompanying person) from the
--   rooming list after the admin reviews the matches in the app, and can remove bookings for cancelled rows.
-- Run exactly once (it renames functions).

alter table public.hotels
  add column companion text not null default '' check (length(companion) <= 120),
  add column companion_id integer references public.people(id) on delete set null,
  add column room_primary boolean not null default true;

-- Person name, for notices and the accompanying field.
create function ops_private.person_name(pid integer) returns text language sql stable
security definer set search_path = '' as $$
  select name from public.people where id = pid;
$$;

-- Notice text for a booking's dates, e.g. "Sat, Nov 7 – Thu, Nov 12".
create function ops_private.stay_text(h public.hotels) returns text language sql immutable set search_path = '' as $$
  select to_char(h.check_in, 'FMDy, Mon FMDD') || ' – ' || to_char(h.check_out, 'FMDy, Mon FMDD');
$$;

-- Copy the shared reservation details from a booking to its linked partner's copy. Returns true if it changed.
create function ops_private.hotel_sync(eid integer, who integer) returns boolean language plpgsql
security definer set search_path = '' as $$
declare h public.hotels; n integer;
begin
  select * into h from public.hotels where event_id = eid and person_id = who;
  if h.id is null or h.companion_id is null then return false; end if;
  update public.hotels p set hotel_name = h.hotel_name, confirmation = h.confirmation, check_in = h.check_in, check_out = h.check_out,
      booked_by = h.booked_by, booked_event = h.booked_event, paid = h.paid, updated_at = now()
    where p.event_id = eid and p.person_id = h.companion_id and p.companion_id = who
      and (p.hotel_name, p.confirmation, p.check_in, p.check_out, p.booked_by, p.booked_event, p.paid)
        is distinct from (h.hotel_name, h.confirmation, h.check_in, h.check_out, h.booked_by, h.booked_event, h.paid);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Remove a booking and look after its partner: a primary's shared copy is removed too (with a notice);
-- removing a copy just unlinks the primary. Linked expenses go with the booking.
create function ops_private.hotel_remove(eid integer, who integer) returns void language plpgsql
security definer set search_path = '' as $$
declare h public.hotels; p public.hotels; ev public.events;
begin
  select * into h from public.hotels where event_id = eid and person_id = who;
  if h.id is null then return; end if;
  select * into ev from public.events where id = eid;
  delete from public.hotels where id = h.id;
  if h.expense_id is not null then delete from public.expenses where id = h.expense_id; end if;
  perform ops_private.pickup_queue(eid, who);
  if h.companion_id is null then return; end if;
  select * into p from public.hotels where event_id = eid and person_id = h.companion_id and companion_id = who;
  if p.id is null then return; end if;
  if h.room_primary and not p.room_primary then
    delete from public.hotels where id = p.id;
    perform ops_private.pickup_queue(eid, p.person_id);
    if not ev.closed then perform ops_private.travel_notice(p.person_id, eid, 'Your shared hotel booking for ' || ev.name || ' was removed. Check My travel.'); end if;
  else
    update public.hotels set companion = '', companion_id = null, room_primary = true where id = p.id;
  end if;
end;
$$;

-- Set a booking's accompanying person. With a People id, link them: they get a shared copy of the reservation
-- (or their own booking becomes the copy), and each names the other. A previous partner is unlinked
-- (their copy removed). Text only (no id): just the name. Raises if the new partner's own booking has an expense.
create function ops_private.hotel_link(eid integer, who integer, ctext text, cid integer) returns void language plpgsql
security definer set search_path = '' as $$
declare h public.hotels; p public.hotels; ev public.events; old integer; me text; third integer;
begin
  select * into h from public.hotels where event_id = eid and person_id = who;
  if h.id is null then return; end if;
  if cid is not null then
    if cid = who then raise exception 'The accompanying person can''t be the traveler.'; end if;
    ctext := ops_private.person_name(cid);
    if ctext is null or not exists(select 1 from public.people where id = cid and not archived) then raise exception 'Choose an active person to accompany them.'; end if;
  end if;
  ctext := left(btrim(coalesce(ctext, '')), 120);
  old := h.companion_id;
  select * into ev from public.events where id = eid;
  me := ops_private.person_name(who);

  -- Unlink the previous partner.
  if old is not null and old is distinct from cid then
    select * into p from public.hotels where event_id = eid and person_id = old and companion_id = who;
    if p.id is not null then
      if h.room_primary and not p.room_primary then
        delete from public.hotels where id = p.id;
        perform ops_private.pickup_queue(eid, old);
        if not ev.closed then perform ops_private.travel_notice(old, eid, 'Your shared hotel booking for ' || ev.name || ' was removed. Check My travel.'); end if;
      else
        update public.hotels set companion = '', companion_id = null, room_primary = true where id = p.id;
      end if;
    end if;
  end if;
  update public.hotels set companion = ctext, companion_id = cid,
      room_primary = case when cid is null or cid is distinct from old then true else room_primary end
    where id = h.id;
  if cid is null or cid = old then return; end if;

  -- Link the new partner.
  select * into p from public.hotels where event_id = eid and person_id = cid;
  if p.id is null then
    insert into public.hotels(event_id, person_id, hotel_name, confirmation, check_in, check_out, booked_by, booked_event, paid,
        companion, companion_id, room_primary, created_by)
      values(eid, cid, h.hotel_name, h.confirmation, h.check_in, h.check_out, h.booked_by, h.booked_event, h.paid,
        me, who, false, auth.uid());
    if not ev.closed then perform ops_private.travel_notice(cid, eid, 'Your hotel for ' || ev.name || ' has been booked, sharing with ' || me || '. See My travel for the details.'); end if;
  else
    if p.expense_id is not null then
      raise exception '% already has a hotel expense from their own booking. Remove it on their booking first.', ctext;
    end if;
    third := case when p.companion_id is distinct from who then p.companion_id end;
    update public.hotels set companion = me, companion_id = who, room_primary = false, add_expense = false, reimburse = false,
        nightly_cost = 0, room_charges = 0, total_cost = 0, receipt_ref = '', updated_at = now()
      where id = p.id;
    -- Their booking was shared with someone else: unlink that person.
    if third is not null then
      update public.hotels set companion = '', companion_id = null, room_primary = true where event_id = eid and person_id = third and companion_id = cid;
    end if;
    perform ops_private.hotel_sync(eid, who);
    if not ev.closed then perform ops_private.travel_notice(cid, eid, 'Your hotel booking for ' || ev.name || ' is now shared with ' || me || '. Check My travel.'); end if;
  end if;
  perform ops_private.pickup_queue(eid, cid);
end;
$$;

revoke all on function ops_private.person_name(integer), ops_private.stay_text(public.hotels), ops_private.hotel_sync(integer, integer),
  ops_private.hotel_remove(integer, integer), ops_private.hotel_link(integer, integer, text, integer)
  from public, anon, authenticated;

-- Snapshot: hotels gain "companion", "companionId", and "primary" (false on a shared copy); "companions": true.
alter function public.ops_snapshot() rename to ops_snapshot_v15;
alter function public.ops_snapshot_v15() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v15() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v15();
  return snapshot || jsonb_build_object('companions', true,
    'hotels', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('companion', h.companion, 'companionId', h.companion_id, 'primary', h.room_primary)
        from public.hotels h where h.id = (x->>'id')::integer), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'hotels') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   saveHotel: the hotel object also takes "companion" (name). Admins may send "companionId" (a People id, or null)
--     to link or unlink. On a shared copy, costs and Add to expenses are ignored (they belong to the primary).
--   delHotel: also removes or unlinks the partner (see hotel_remove).
--   importHotels [eventId, rows, removePersonIds] (admins). rows: [{e, conf, in, out, companion, companionId}].
--     New bookings: the event venue, booked by Event, Event/master bill. Existing: confirmation #, dates, and
--     accompanying person updated; everything else kept. removePersonIds: bookings to remove (cancelled rows).
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v15;
alter function public.ops_command_v15(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v15(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; pid integer; eid integer; who integer; o jsonb; h public.hotels; ev public.events;
  cid integer; ctext text; set_link boolean := false; set_text boolean := false; r jsonb; cin date; cout date; conf text;
  existed public.hotels; n_new integer := 0; n_upd integer := 0; n_del integer := 0; x jsonb;
begin
  admin := coalesce(ops_private.is_admin(), false);
  if action = 'importHotels' then
    if not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    select revision into v from public.ops_state where id = 1 for update;
    if expected_revision is null or v <> expected_revision then
      raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
    end if;
    eid := (args->>0)::integer;
    select * into ev from public.events where id = eid;
    if ev.id is null then raise exception 'Choose an event.'; end if;
    if jsonb_typeof(args->1) <> 'array' or jsonb_array_length(args->1) > 500 then raise exception 'Invalid rooming list.'; end if;
    for x in select * from jsonb_array_elements(coalesce(args->2, '[]'::jsonb)) loop
      if exists(select 1 from public.hotels where event_id = eid and person_id = (x #>> '{}')::integer) then
        perform ops_private.hotel_remove(eid, (x #>> '{}')::integer); n_del := n_del + 1;
      end if;
    end loop;
    for r in select * from jsonb_array_elements(args->1) loop
      who := (r->>'e')::integer;
      if not exists(select 1 from public.people where id = who and not archived) then raise exception 'Choose an active person for each row.'; end if;
      if coalesce(r->>'in', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(r->>'out', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Every row needs arrival and departure dates (%).', ops_private.person_name(who);
      end if;
      cin := (r->>'in')::date; cout := (r->>'out')::date;
      if cout <= cin then raise exception 'The departure date must be after the arrival date (%).', ops_private.person_name(who); end if;
      conf := left(btrim(coalesce(r->>'conf', '')), 60);
      select * into existed from public.hotels where event_id = eid and person_id = who;
      insert into public.hotels(event_id, person_id, hotel_name, confirmation, check_in, check_out, booked_by, booked_event, paid, created_by)
        values(eid, who, coalesce(ev.venue, ''), conf, cin, cout, null, true, 'event', auth.uid())
        on conflict (event_id, person_id) do update set confirmation = excluded.confirmation, check_in = excluded.check_in,
          check_out = excluded.check_out, updated_at = now()
          where (public.hotels.confirmation, public.hotels.check_in, public.hotels.check_out) is distinct from (excluded.confirmation, excluded.check_in, excluded.check_out);
      cid := case when jsonb_typeof(r->'companionId') = 'number' then (r->>'companionId')::integer end;
      ctext := left(btrim(coalesce(r->>'companion', '')), 120);
      select * into h from public.hotels where event_id = eid and person_id = who;
      if h.companion_id is distinct from cid or (cid is null and h.companion <> ctext) then perform ops_private.hotel_link(eid, who, ctext, cid); end if;
      perform ops_private.hotel_sync(eid, who);
      perform ops_private.pickup_queue(eid, who);
      select * into h from public.hotels where event_id = eid and person_id = who;
      if existed.id is null then
        n_new := n_new + 1;
        if not ev.closed then perform ops_private.travel_notice(who, eid, 'Your hotel for ' || ev.name || ' has been booked: confirmation ' || coalesce(nullif(h.confirmation, ''), '–') || ', ' || ops_private.stay_text(h) || '. See My travel.'); end if;
      elsif (existed.confirmation, existed.check_in, existed.check_out, existed.companion) is distinct from (h.confirmation, h.check_in, h.check_out, h.companion) then
        n_upd := n_upd + 1;
        if not ev.closed then perform ops_private.travel_notice(who, eid, 'Your hotel booking for ' || ev.name || ' was updated: confirmation ' || coalesce(nullif(h.confirmation, ''), '–') || ', ' || ops_private.stay_text(h) || '. Check My travel.'); end if;
      end if;
    end loop;
    insert into public.activity_log(actor_id, action, details)
      values(auth.uid(), action, jsonb_build_object('event_id', eid, 'name', ev.name, 'added', n_new, 'updated', n_upd, 'removed', n_del));
    update public.ops_state set revision = revision + 1 where id = 1;
    return public.ops_snapshot();
  end if;

  if action = 'delHotel' then
    select event_id, person_id into eid, who from public.hotels where id = (args->>0)::integer;
    select * into h from public.hotels where id = (args->>0)::integer;
    -- Shared copies are changed on the primary's booking; travelers can't remove one.
    perform ops_private.ops_command_v15(action, args, expected_revision);
    if h.id is not null and h.companion_id is not null then
      -- The row is gone; recreate the partner handling from the saved copy.
      if h.room_primary then
        delete from public.hotels where event_id = eid and person_id = h.companion_id and companion_id = who and not room_primary;
        perform ops_private.pickup_queue(eid, h.companion_id);
        select * into ev from public.events where id = eid;
        if found and not ev.closed then perform ops_private.travel_notice(h.companion_id, eid, 'Your shared hotel booking for ' || ev.name || ' was removed. Check My travel.'); end if;
      else
        update public.hotels set companion = '', companion_id = null, room_primary = true where event_id = eid and person_id = h.companion_id and companion_id = who;
      end if;
    end if;
    return public.ops_snapshot();
  end if;

  if action <> 'saveHotel' then return ops_private.ops_command_v15(action, args, expected_revision); end if;

  pid := ops_private.person_id();
  eid := (args->>0)::integer; who := case when admin then (args->>1)::integer else pid end; o := args->2;
  if jsonb_typeof(o) <> 'object' then return ops_private.ops_command_v15(action, args, expected_revision); end if;
  select * into h from public.hotels where event_id = eid and person_id = who;
  -- A shared copy carries no costs or expense: those stay on the primary booking.
  if h.id is not null and not h.room_primary then
    o := o || jsonb_build_object('addExpense', false, 'nightly', '', 'charges', '', 'total', '');
  end if;
  if admin and o ? 'companionId' and not (h.id is not null and not h.room_primary) then
    set_link := true;
    cid := case when jsonb_typeof(o->'companionId') = 'number' then (o->>'companionId')::integer end;
    if cid is not null and (cid = who or not exists(select 1 from public.people where id = cid and not archived)) then
      raise exception 'Choose an active person to accompany them.';
    end if;
  end if;
  if o ? 'companion' and not (h.id is not null and (not h.room_primary or (h.companion_id is not null and not admin))) then
    set_text := true; ctext := left(btrim(coalesce(o->>'companion', '')), 120);
  end if;

  perform ops_private.ops_command_v15(action, jsonb_build_array(args->0, args->1, o), expected_revision);

  if set_link then perform ops_private.hotel_link(eid, who, ctext, cid);
  elsif set_text then
    select * into h from public.hotels where event_id = eid and person_id = who;
    if h.companion_id is null then update public.hotels set companion = ctext where id = h.id; end if;
  end if;
  if ops_private.hotel_sync(eid, who) then
    select * into h from public.hotels where event_id = eid and person_id = who;
    select * into ev from public.events where id = eid;
    if not ev.closed then perform ops_private.travel_notice(h.companion_id, eid, 'Your shared hotel booking for ' || ev.name || ' was updated: confirmation ' || coalesce(nullif(h.confirmation, ''), '–') || ', ' || ops_private.stay_text(h) || '. Check My travel.'); end if;
  end if;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
