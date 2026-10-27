-- 2026-10-27 fix: the run-of-show import matched activities by day and name only, so when a sheet repeats a name on
-- the same day ("General Session" at 8:30, 9:00 and 10:00; two "Place Signage" rows), each later row overwrote the
-- earlier one. Now each row takes its own activity (same day and name, preferring the same start time, never one an
-- earlier row of the same import took), and Allow overlap ("ov") is applied to that same activity. Run exactly once.

alter function public.ops_command(text, jsonb, integer) rename to ops_command_v21;
alter function public.ops_command_v21(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v21(text, jsonb, integer) from public, anon, authenticated;

-- importSchedule is handled here; everything else (including the Allow overlap handling of addSession /
-- editSession) goes to the previous command function unchanged.
create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; ev public.events; r jsonb; o jsonb; ttl text; rname text; room integer; d integer; a integer; b integer;
  det text; ids integer[]; leads integer[]; everyone boolean; s public.activities; sid integer; rec record; aid integer;
  n_new integer := 0; n_upd integer := 0; n_rooms integer := 0; want integer; used integer[] := '{}'; ov boolean;
begin
  if action <> 'importSchedule' then return ops_private.ops_command_v21(action, args, expected_revision); end if;

  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  eid := (args->>0)::integer; o := coalesce(args->1, '{}'::jsonb);
  select * into ev from public.events where id = eid;
  if ev.id is null then raise exception 'Choose an event.'; end if;
  if jsonb_typeof(args->2) <> 'array' or jsonb_array_length(args->2) > 300 then raise exception 'Invalid run of show.'; end if;
  want := nullif(o->>'days', '')::integer;
  if want is not null then
    if want < 1 or want > 14 then raise exception 'An event can be 14 days at most.'; end if;
    if want > ev.days then update public.events set days = want where id = eid; ev.days := want; end if;
  end if;
  perform set_config('epi.quiet_push', 'on', true);

  for r in select * from jsonb_array_elements(args->2) loop
    ttl := btrim(coalesce(r->>'title', ''));
    if ttl = '' or length(ttl) > 200 then raise exception 'Every activity needs a name (up to 200 characters).'; end if;
    d := (r->>'day')::integer; a := (r->>'start')::integer; b := (r->>'end')::integer;
    if d is null or d < 0 or d >= ev.days then raise exception '% is outside the event''s days. Extend the event first.', ttl; end if;
    if a is null or b is null or a < 0 or a > 1439 or b > 1440 or b < a then raise exception 'Check the start and stop times for %.', ttl; end if;
    det := left(btrim(coalesce(r->>'det', '')), 2000);
    everyone := coalesce((r->>'all')::boolean, false);
    select coalesce(array_agg(distinct p.id), '{}') into ids
      from jsonb_array_elements_text(coalesce(r->'leads', '[]') || coalesce(r->'members', '[]')) x
      join public.people p on p.id = x::integer and not p.archived;
    -- Only Staff and Admin people can be team leads (as everywhere else); others are assigned as members.
    select coalesce(array_agg(distinct p.id), '{}') into leads
      from jsonb_array_elements_text(coalesce(r->'leads', '[]')) x
      join public.people p on p.id = x::integer and not p.archived and p.account_type in ('staff', 'admin');

    rname := left(btrim(coalesce(r->>'room', '')), 120);
    if rname = '' then raise exception 'Every activity needs a room (%).', ttl; end if;
    select id into room from public.rooms where lower(name) = lower(rname) limit 1;
    if room is null then insert into public.rooms(name) values(rname) returning id into room; n_rooms := n_rooms + 1; end if;

    ov := case when r ? 'ov' then coalesce((r->>'ov')::boolean, false) end;
    -- A name can repeat on the same day ("General Session" at 8:30 and 9:00): each row takes its own activity,
    -- preferring one at the same start time, and never one an earlier row of this import already took.
    select * into s from public.activities where event_id = eid and day = d and lower(btrim(title)) = lower(ttl) and not (id = any(used))
      order by (start_minute = a) desc, start_minute, id limit 1;
    if s.id is null then
      insert into public.activities(event_id, room_id, title, day, start_minute, end_minute, staff_needed, requires_ack, details, allow_overlap)
        values(eid, room, ttl, d, a, b, cardinality(ids), case when everyone then false end, det, coalesce(ov, false)) returning id into sid;
      n_new := n_new + 1;
    else
      sid := s.id;
      update public.activities set room_id = room, start_minute = a, end_minute = b, staff_needed = cardinality(ids),
          requires_ack = case when everyone then false else requires_ack end, details = det,
          allow_overlap = coalesce(ov, allow_overlap)
        where id = sid;
      if (s.room_id, s.start_minute, s.end_minute) is distinct from (room, a, b) then
        for rec in select id from public.assignments where activity_id = sid and person_id = any(ids) loop
          update public.assignments set acknowledged = false, checked_in = false, confirmed = false, tag = 'changed', sequence = sequence + 1, calendar_prompt = false where id = rec.id;
          if not everyone then perform ops_private.notify_assignment(rec.id, 'Activity changed'); end if;
        end loop;
      end if;
      if (s.room_id, s.start_minute, s.end_minute, s.details, s.staff_needed, s.requires_ack, s.allow_overlap) is distinct from (room, a, b, det, cardinality(ids), case when everyone then false else s.requires_ack end, coalesce(ov, s.allow_overlap))
        or exists(select 1 from public.assignments where activity_id = sid and not (person_id = any(ids)))
        or exists(select 1 from unnest(ids) x where not exists(select 1 from public.assignments where activity_id = sid and person_id = x)) then
        n_upd := n_upd + 1;
      end if;
      -- People no longer on the team.
      for rec in select a0.id, a0.person_id from public.assignments a0 where a0.activity_id = sid and not (a0.person_id = any(ids)) loop
        insert into public.notifications(person_id, message) values(rec.person_id, 'Removed from: ' || ttl);
        delete from public.assignments where id = rec.id;
      end loop;
    end if;
    used := used || sid;
    -- New team members.
    for rec in select x from unnest(ids) x where not exists(select 1 from public.assignments where activity_id = sid and person_id = x) loop
      insert into public.assignments(person_id, activity_id) values(rec.x, sid) returning id into aid;
      if not everyone then perform ops_private.notify_assignment(aid, 'New assignment'); end if;
    end loop;
    update public.assignments set lead = (person_id = any(leads)) where activity_id = sid and lead is distinct from (person_id = any(leads));
  end loop;

  insert into public.activity_log(actor_id, action, details)
    values(auth.uid(), action, jsonb_build_object('event_id', eid, 'name', ev.name, 'added', n_new, 'updated', n_upd, 'rooms_added', n_rooms));
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
