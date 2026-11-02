-- 2026-11-02 owner request (40-50 people using the app at once): fewer "Another user changed the data" refusals and
-- lighter saves.
--
-- 1. Record-level conflict check. Until now every save was refused when ANY change had been saved since the app last
--    loaded the data (the single data revision), so with many people working, saves bounced all the time even when
--    nobody touched the same thing. Now:
--      * the edit dialogs (editSession, editEvent, editRoom, editStaff, and their deletes) are refused only when that
--        same activity, event, room or person changed since the dialog was opened;
--      * every other save goes through on the current data.
--    Changes to those four tables are tracked by row triggers in ops_private.record_changes (one row per record, the
--    revision the change happened at; no data copied). The outer ops_command and ops_save_person decide and then hand
--    the current revision to the existing functions, so their own checks pass unchanged.
--
-- 2. Lighter saves. Every save ended by rebuilding the whole data set (about 0.3-0.8 s on production) while holding
--    the data lock, so saves queued behind each other. ops_command_light / ops_save_person_light run the same save,
--    skip that rebuild (transaction-local ops.light) and return only {light, revision}; the app then loads the data
--    with a separate read that holds no lock. The snapshot says "lightSaves": true so the app knows to use them;
--    older databases keep the full response.
--
-- Revision conflicts use PT409 (never 40001; see 20261029120000). Run exactly once (it renames functions).
-- Note: public.ops_save_person is now a wrapper; its old body is ops_private.ops_save_person_v1.

create table ops_private.record_changes (
  tbl text not null,
  rid integer not null,
  after_rev integer not null,
  primary key (tbl, rid)
);
revoke all on ops_private.record_changes from public, anon, authenticated;

-- after_rev = the data revision while the change was made; it becomes visible in snapshots from after_rev + 1, so an
-- editor opened at revision R has not seen it when after_rev >= R.
create function ops_private.track_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ops_private.record_changes(tbl, rid, after_rev)
    values(tg_table_name, old.id, coalesce((select revision from public.ops_state where id = 1), 0))
    on conflict (tbl, rid) do update set after_rev = greatest(ops_private.record_changes.after_rev, excluded.after_rev);
  return null;
end;
$$;
revoke all on function ops_private.track_change() from public, anon, authenticated;

create trigger activities_track_update after update on public.activities for each row
  when (old.* is distinct from new.*) execute function ops_private.track_change();
create trigger activities_track_delete after delete on public.activities for each row execute function ops_private.track_change();
create trigger events_track_update after update on public.events for each row
  when (old.* is distinct from new.*) execute function ops_private.track_change();
create trigger events_track_delete after delete on public.events for each row execute function ops_private.track_change();
create trigger rooms_track_update after update on public.rooms for each row
  when (old.* is distinct from new.*) execute function ops_private.track_change();
create trigger rooms_track_delete after delete on public.rooms for each row execute function ops_private.track_change();
create trigger people_track_update after update on public.people for each row
  when (old.* is distinct from new.*) execute function ops_private.track_change();
create trigger people_track_delete after delete on public.people for each row execute function ops_private.track_change();

-- Which revision a save runs with: the current one, unless it is an edit of a record changed since the editor opened.
create function ops_private.rebase(action text, args jsonb, expected integer, cur integer) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare t text; label text; target integer;
begin
  if expected is null or expected >= cur then return expected; end if;   -- unchanged, or let the inner check refuse
  if action in ('editSession', 'delSession') then t := 'activities'; label := 'activity';
  elsif action in ('editEvent', 'delEvent') then t := 'events'; label := 'event';
  elsif action in ('editStaff', 'delStaff') then t := 'people'; label := 'person';
  elsif action in ('editRoom', 'delRoom') then t := 'rooms'; label := 'room';
  else return cur;
  end if;
  if t = 'rooms' then   -- rooms are named by their (old) name
    select id into target from public.rooms where name = args->>0 limit 1;
  elsif jsonb_typeof(args->0) = 'number' or (args->>0) ~ '^\d+$' then
    target := (args->>0)::integer;
  end if;
  if target is not null and exists(select 1 from ops_private.record_changes c where c.tbl = t and c.rid = target and c.after_rev >= expected) then
    raise exception 'Someone else changed this % while you were editing it. Reopen it to see their changes, then save again.', label
      using errcode = 'PT409';
  end if;
  return cur;
end;
$$;
revoke all on function ops_private.rebase(text, jsonb, integer, integer) from public, anon, authenticated;

-- Outer save functions: decide the revision, then run the existing chain with it.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v28;
alter function public.ops_command_v28(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v28(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  select revision into v from public.ops_state where id = 1 for update;
  return ops_private.ops_command_v28(action, args, ops_private.rebase(action, args, expected_revision, v));
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;

alter function public.ops_save_person(integer, jsonb, integer) rename to ops_save_person_v1;
alter function public.ops_save_person_v1(integer, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_save_person_v1(integer, jsonb, integer) from public, anon, authenticated;

create function public.ops_save_person(target_person_id integer, person jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  select revision into v from public.ops_state where id = 1 for update;
  return ops_private.ops_save_person_v1(target_person_id, person,
    ops_private.rebase(case when target_person_id is null then 'addStaff' else 'editStaff' end,
      jsonb_build_array(target_person_id), expected_revision, v));
end;
$$;
revoke all on function public.ops_save_person(integer, jsonb, integer) from public, anon;
grant execute on function public.ops_save_person(integer, jsonb, integer) to authenticated;

-- Snapshot: skipped inside a light save; otherwise unchanged plus "lightSaves": true.
alter function public.ops_snapshot() rename to ops_snapshot_v27;
alter function public.ops_snapshot_v27() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v27() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
begin
  if current_setting('ops.light', true) = 'on' then return '{}'::jsonb; end if;
  return ops_private.ops_snapshot_v27() || jsonb_build_object('lightSaves', true);
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Light saves: the same save, without rebuilding the data; the app loads it afterwards with ops_snapshot().
create function public.ops_command_light(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('ops.light', 'on', true);
  perform public.ops_command(action, args, expected_revision);
  perform set_config('ops.light', '', true);
  return jsonb_build_object('light', true, 'revision', (select revision from public.ops_state where id = 1));
end;
$$;
revoke all on function public.ops_command_light(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command_light(text, jsonb, integer) to authenticated;

create function public.ops_save_person_light(target_person_id integer, person jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('ops.light', 'on', true);
  perform public.ops_save_person(target_person_id, person, expected_revision);
  perform set_config('ops.light', '', true);
  return jsonb_build_object('light', true, 'revision', (select revision from public.ops_state where id = 1));
end;
$$;
revoke all on function public.ops_save_person_light(integer, jsonb, integer) from public, anon;
grant execute on function public.ops_save_person_light(integer, jsonb, integer) to authenticated;
