-- 2026-10-20 owner request: admins can close an event. A closed event and everything in it (activities,
-- assignments, notices about them, lunches/breaks, floorplans, expenses) is hidden from staff and contractors
-- everywhere, and they cannot act on it. Admins still see and manage it and can reopen it.

alter table public.events add column closed boolean not null default false;

create function ops_private.event_open(eid integer) returns boolean language sql stable
security definer set search_path = '' as $$
  select not coalesce((select closed from public.events where id = eid), false);
$$;
revoke all on function ops_private.event_open(integer) from public, anon;
grant execute on function ops_private.event_open(integer) to authenticated;
-- Looks up an activity's event without going through row rules (avoids policy recursion between activities and assignments).
create function ops_private.activity_open(sid integer) returns boolean language sql stable
security definer set search_path = '' as $$
  select not coalesce((select e.closed from public.activities s join public.events e on e.id = s.event_id where s.id = sid), false);
$$;
revoke all on function ops_private.activity_open(integer) from public, anon;
grant execute on function ops_private.activity_open(integer) to authenticated;

-- Row rules: non-admins never see rows that belong to a closed event.
drop policy events_read on public.events;
create policy events_read on public.events for select to authenticated using (
  ops_private.is_admin() or (not closed and exists(select 1 from public.activities a where a.event_id = events.id)));
drop policy activities_read on public.activities;
create policy activities_read on public.activities for select to authenticated using (
  ops_private.is_admin() or (ops_private.event_open(event_id)
    and exists(select 1 from public.assignments a where a.activity_id = activities.id and a.person_id = ops_private.person_id())));
drop policy assignments_read on public.assignments;
create policy assignments_read on public.assignments for select to authenticated using (
  ops_private.is_admin() or (person_id = ops_private.person_id()
    and ops_private.activity_open(activity_id)));
drop policy breaks_read on public.breaks;
create policy breaks_read on public.breaks for select to authenticated using (
  ops_private.is_admin() or (person_id = ops_private.person_id() and ops_private.event_open(event_id)));
drop policy floorplans_read on public.floorplans;
create policy floorplans_read on public.floorplans for select to authenticated using (
  ops_private.is_admin() or (ops_private.can_view_floorplans() and ops_private.event_open(event_id)));
drop policy expenses_read on public.expenses;
create policy expenses_read on public.expenses for select to authenticated using (
  ops_private.is_admin() or (person_id = ops_private.person_id() and ops_private.event_open(event_id)));

-- Floorplan files are stored under "<event id>/"; non-admins cannot open files of a closed event.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists floorplans_viewer_select on storage.objects';
    execute $p$create policy floorplans_viewer_select on storage.objects for select to authenticated
      using (bucket_id = 'floorplans' and (ops_private.is_admin() or (ops_private.can_view_floorplans()
        and split_part(name, '/', 1) ~ '^\d+$' and ops_private.event_open(split_part(name, '/', 1)::integer))))$p$;
  end if;
end;
$$;

-- Snapshot: admins get every event with a "closed" list; everyone else gets nothing from closed events.
alter function public.ops_snapshot() rename to ops_snapshot_v3;
alter function public.ops_snapshot_v3() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v3() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; closed_ids integer[]; acts integer[]; asgs integer[];
begin
  snapshot := ops_private.ops_snapshot_v3();
  closed_ids := coalesce((select array_agg(id order by id) from public.events where closed), '{}');
  snapshot := snapshot || jsonb_build_object('closedEvents', to_jsonb(closed_ids));
  if snapshot->>'role' = 'admin' or cardinality(closed_ids) = 0 then return snapshot; end if;
  snapshot := snapshot || jsonb_build_object('closedEvents', '[]'::jsonb,
    'events', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'events') x where not (x->>'id')::integer = any(closed_ids)), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'activities') x where not (x->>'ev')::integer = any(closed_ids)), '[]'::jsonb),
    'breaks', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'breaks') x where not (x->>'ev')::integer = any(closed_ids)), '[]'::jsonb),
    'floorplans', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'floorplans') x where not (x->>'ev')::integer = any(closed_ids)), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'expenses') x where not (x->>'ev')::integer = any(closed_ids)), '[]'::jsonb));
  acts := coalesce((select array_agg((x->>'id')::integer) from jsonb_array_elements(snapshot->'activities') x), '{}');
  snapshot := snapshot || jsonb_build_object(
    'asg', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'asg') x where (x->>'s')::integer = any(acts)), '[]'::jsonb));
  asgs := coalesce((select array_agg((x->>'id')::integer) from jsonb_array_elements(snapshot->'asg') x), '{}');
  snapshot := snapshot || jsonb_build_object(
    'notes', coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'notes') x
      where x->'aid' is null or jsonb_typeof(x->'aid') = 'null' or (x->>'aid')::integer = any(asgs)), '[]'::jsonb));
  return snapshot;
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: admins close/reopen events; non-admins cannot act on anything in a closed event.
--   setEventClosed [eventId, true|false]
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v4;
alter function public.ops_command_v4(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v4(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; eid integer;
begin
  admin := coalesce(ops_private.is_admin(), false);
  if action = 'setEventClosed' then
    if not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    select revision into v from public.ops_state where id = 1 for update;
    if expected_revision is null or v <> expected_revision then
      raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
    end if;
    update public.events set closed = coalesce((args->>1)::boolean, false) where id = (args->>0)::integer;
    if not found then raise exception 'Event no longer exists.'; end if;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
    update public.ops_state set revision = revision + 1 where id = 1;
    return public.ops_snapshot();
  end if;
  if not admin then
    eid := case
      when action in ('ack', 'checkIn', 'calAdd', 'calSkip') then
        (select s.event_id from public.assignments a join public.activities s on s.id = a.activity_id where a.id = (args->>0)::integer)
      when action = 'addExpense' then (args->>0)::integer
      when action in ('editExpense', 'delExpense') then (select event_id from public.expenses where id = (args->>0)::integer)
      when action = 'clockOut' and jsonb_typeof(args->1) = 'number' then (select event_id from public.breaks where id = (args->>1)::integer)
    end;
    if eid is not null and not ops_private.event_open(eid) then
      raise exception 'This event is closed.' using errcode = '42501';
    end if;
  end if;
  return ops_private.ops_command_v4(action, args, expected_revision);
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
