-- 2026-11-02 fix: Add people (assignMany), Acknowledge all and Got it all timed out with many people/notices.
--   Each item runs through the existing single command, and every command ends by building the full snapshot
--   (about 0.4 s on production), so 20+ items passed the 8-second statement limit and the whole request was
--   cancelled. Now, while a bulk command runs, inner commands skip that snapshot (transaction-local setting
--   ops.bulk = on) and the snapshot is built once at the end. Nothing else changes.
-- CREATE OR REPLACE keeps the functions' owners, grants and SECURITY DEFINER. Safe to run more than once.

create or replace function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
begin
  -- Inside a bulk command the inner commands' snapshots are thrown away: skip building them.
  if current_setting('ops.bulk', true) = 'on' then return '{}'::jsonb; end if;
  return ops_private.ops_snapshot_v26() || jsonb_build_object('assignMany', true);
end;
$$;

create or replace function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; sid integer; x integer; n integer := 0; t text;
begin
  if action in ('ackAll', 'dismissAll') then
    perform set_config('ops.bulk', 'on', true);
    perform ops_private.ops_command_v27(action, args, expected_revision);
    perform set_config('ops.bulk', '', true);
    return public.ops_snapshot();
  end if;
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
  perform set_config('ops.bulk', 'on', true);
  for x in select distinct (val)::integer from jsonb_array_elements_text(args->0) j(val) loop
    continue when exists(select 1 from public.assignments where activity_id = sid and person_id = x);
    begin
      perform ops_private.ops_command_v27('assign', jsonb_build_array(x, sid), (select revision from public.ops_state where id = 1));
      n := n + 1;
    exception when others then null;  -- archived or otherwise refused: skip this person
    end;
  end loop;
  perform set_config('ops.bulk', '', true);
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('activity_id', sid, 'title', t, 'assigned', n));
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
