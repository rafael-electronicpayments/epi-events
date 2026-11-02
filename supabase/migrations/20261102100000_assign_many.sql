-- 2026-11-02 owner request: Add people to an activity from a dialog, many at once (Select all by type).
--   assignMany [[personId, ...], activityId]: admins; each person goes through the existing single "assign"
--   (same checks, notices and pushes); people already on the activity, archived, or otherwise refused are skipped.
--   Snapshot: "assignMany": true tells the app this database has it (older ones get one assign per person).
-- Revision conflicts use PT409 (never 40001; see 20261029120000). Run exactly once (it renames functions).

alter function public.ops_snapshot() rename to ops_snapshot_v26;
alter function public.ops_snapshot_v26() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v26() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
begin
  return ops_private.ops_snapshot_v26() || jsonb_build_object('assignMany', true);
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

alter function public.ops_command(text, jsonb, integer) rename to ops_command_v27;
alter function public.ops_command_v27(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v27(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; sid integer; x integer; n integer := 0; t text;
begin
  if action <> 'assignMany' then return ops_private.ops_command_v27(action, args, expected_revision); end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = 'PT409';
  end if;
  sid := (args->>1)::integer;
  select title into t from public.activities where id = sid;
  if t is null then raise exception 'This activity no longer exists.'; end if;
  if jsonb_typeof(args->0) <> 'array' or jsonb_array_length(args->0) = 0 then raise exception 'Choose at least one person.'; end if;
  if jsonb_array_length(args->0) > 500 then raise exception 'Choose up to 500 people at a time.'; end if;
  for x in select distinct (val)::integer from jsonb_array_elements_text(args->0) t(val) loop
    continue when exists(select 1 from public.assignments where activity_id = sid and person_id = x);
    begin
      perform ops_private.ops_command_v27('assign', jsonb_build_array(x, sid), (select revision from public.ops_state where id = 1));
      n := n + 1;
    exception when others then null;  -- archived or otherwise refused: skip this person
    end;
  end loop;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('activity_id', sid, 'title', t, 'assigned', n));
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
