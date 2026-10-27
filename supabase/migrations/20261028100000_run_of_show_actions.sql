-- 2026-10-27 owner request: the schedule is the full run of show, so activities can be
--   * staffed optionally: Staff needed 0 means no set number (AV / Encore and others run it); people can still be assigned;
--   * a one-moment action ("At 9:00 AM close event hall doors"): no end time, stored as end = start;
--   * "Managed by" free text (for example "Encore AV"), shown to everyone on the schedule.
-- The run-of-show import no longer requires a stop time (a row with only a start becomes a one-moment action) and
-- sets Staff needed to the number of people on the row (0 when nobody is named). Run exactly once.

alter table public.activities drop constraint activities_staff_needed_check,
  add constraint activities_staff_needed_check check (staff_needed >= 0);
alter table public.activities drop constraint activities_check,
  add constraint activities_check check (end_minute >= start_minute);
alter table public.activities drop constraint activities_end_minute_check,
  add constraint activities_end_minute_check check (end_minute between 0 and 1440);
alter table public.activities add column managed_by text not null default '' check (length(managed_by) <= 120);

-- Snapshot: everything from before, plus per activity "m" (Managed by, when set); "runOfShow": true tells the app
-- this database supports optional staff, no end time, and Managed by.
alter function public.ops_snapshot() rename to ops_snapshot_v19;
alter function public.ops_snapshot_v19() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v19() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v19();
  return snapshot || jsonb_build_object('runOfShow', true,
    'activities', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('m', s.managed_by)
        from public.activities s where s.id = (x->>'id')::integer and s.managed_by <> ''), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'activities') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   addSession / editSession: the last argument {det, nt} may also carry "by" (Managed by, up to 120 characters).
--   importSchedule: as before, except a row's end may equal its start (one-moment action) and Staff needed is the
--   number of people on the row (0 allowed).
-- Everything else goes to the previous command function unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v19;
alter function public.ops_command_v19(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v19(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; ev public.events; r jsonb; o jsonb; ttl text; rname text; room integer; d integer; a integer; b integer;
  det text; ids integer[]; leads integer[]; everyone boolean; s public.activities; sid integer; rec record; aid integer;
  n_new integer := 0; n_upd integer := 0; n_rooms integer := 0; want integer; info jsonb; mby text; result jsonb; target integer;
begin
  if action in ('addSession', 'editSession') then
    if jsonb_typeof(args) = 'array' and jsonb_array_length(args) > 0 and jsonb_typeof(args->-1) = 'object' and (args->-1) ? 'by' then
      info := args->-1;
      mby := btrim(coalesce(info->>'by', ''));
      if length(mby) > 120 then raise exception 'Managed by can be up to 120 characters.'; end if;
      args := jsonb_set(args, array[(jsonb_array_length(args) - 1)::text], info - 'by');
    end if;
    result := ops_private.ops_command_v19(action, args, expected_revision);
    if mby is not null then
      -- Writes are serialized by the ops_state row lock, so the newest activity is the one just created.
      target := case when action = 'addSession' then (select max(id) from public.activities) else (args->>0)::integer end;
      update public.activities set managed_by = mby where id = target and managed_by <> mby;
      if found then result := public.ops_snapshot(); end if;
    end if;
    return result;
  end if;
  if action <> 'importSchedule' then return ops_private.ops_command_v19(action, args, expected_revision); end if;

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

    select * into s from public.activities where event_id = eid and day = d and lower(btrim(title)) = lower(ttl) order by id limit 1;
    if s.id is null then
      insert into public.activities(event_id, room_id, title, day, start_minute, end_minute, staff_needed, requires_ack, details)
        values(eid, room, ttl, d, a, b, cardinality(ids), case when everyone then false end, det) returning id into sid;
      n_new := n_new + 1;
    else
      sid := s.id;
      update public.activities set room_id = room, start_minute = a, end_minute = b, staff_needed = cardinality(ids),
          requires_ack = case when everyone then false else requires_ack end, details = det
        where id = sid;
      if (s.room_id, s.start_minute, s.end_minute) is distinct from (room, a, b) then
        for rec in select id from public.assignments where activity_id = sid and person_id = any(ids) loop
          update public.assignments set acknowledged = false, checked_in = false, confirmed = false, tag = 'changed', sequence = sequence + 1, calendar_prompt = false where id = rec.id;
          if not everyone then perform ops_private.notify_assignment(rec.id, 'Activity changed'); end if;
        end loop;
      end if;
      if (s.room_id, s.start_minute, s.end_minute, s.details, s.staff_needed, s.requires_ack) is distinct from (room, a, b, det, cardinality(ids), case when everyone then false else s.requires_ack end)
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
