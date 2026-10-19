-- 2026-10-19 owner request: rooms and activities can turn off acknowledgment and check-in.
-- One switch covers both. Rooms set the default (on); an activity can follow its room (null) or override it.

alter table public.rooms add column requires_ack boolean not null default true;
alter table public.activities add column requires_ack boolean;

-- Snapshot: add roomAck {room name: bool} and actAck {activity id: bool} for overrides only.
alter function public.ops_snapshot() rename to ops_snapshot_roles;
alter function public.ops_snapshot_roles() set schema ops_private;
revoke all on function ops_private.ops_snapshot_roles() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_roles();
  return snapshot || jsonb_build_object(
    'roomAck', coalesce((select jsonb_object_agg(r.name, r.requires_ack) from public.rooms r
      where snapshot->'rooms' ? r.name), '{}'::jsonb),
    'actAck', coalesce((select jsonb_object_agg(s.id::text, s.requires_ack) from public.activities s
      where s.requires_ack is not null and s.id in (select (x->>'id')::integer from jsonb_array_elements(snapshot->'activities') x)), '{}'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: the original command function keeps all its rules; this wrapper adds the optional flag argument.
--   addRoom [name, flag?]              editRoom [old, new, flag?]
--   addSession [t, r, d, a, b, n, q, eventId]   editSession [id, t, r, d, a, b, n, q]
--   q is true, false, or null (follow the room).
alter function public.ops_command(text, jsonb, integer) rename to ops_command_base;
alter function public.ops_command_base(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_base(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  flag jsonb; v integer; target integer;
begin
  if action = 'addRoom' and jsonb_array_length(args) > 1 then
    flag := args->1;
    perform ops_private.ops_command_base(action, jsonb_build_array(args->0), expected_revision);
    update public.rooms set requires_ack = coalesce((flag)::text::boolean, true) where name = btrim(args->>0);
  elsif action = 'editRoom' and jsonb_array_length(args) > 2 then
    flag := args->2;
    if btrim(args->>1) = args->>0 then
      -- Setting-only change: no rename, so assigned people are not asked to re-acknowledge.
      if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
      select revision into v from public.ops_state where id = 1 for update;
      if expected_revision is null or v <> expected_revision then
        raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
      end if;
      if not exists(select 1 from public.rooms where name = args->>0) then raise exception 'Room no longer exists.'; end if;
      update public.rooms set requires_ack = coalesce((flag)::text::boolean, true) where name = args->>0;
      insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
      update public.ops_state set revision = revision + 1 where id = 1;
    else
      perform ops_private.ops_command_base(action, jsonb_build_array(args->0, args->1), expected_revision);
      update public.rooms set requires_ack = coalesce((flag)::text::boolean, true) where name = btrim(args->>1);
    end if;
  elsif action = 'addSession' and jsonb_array_length(args) > 7 then
    flag := args->6;
    perform ops_private.ops_command_base(action, args - 6, expected_revision);
    -- Writes are serialized by the ops_state row lock, so the newest activity is the one just created.
    select max(id) into target from public.activities;
    update public.activities set requires_ack = case when jsonb_typeof(flag) = 'boolean' then (flag)::text::boolean end where id = target;
  elsif action = 'editSession' and jsonb_array_length(args) > 7 then
    flag := args->7;
    perform ops_private.ops_command_base(action, args - 7, expected_revision);
    update public.activities set requires_ack = case when jsonb_typeof(flag) = 'boolean' then (flag)::text::boolean end where id = (args->>0)::integer;
  else
    perform ops_private.ops_command_base(action, args, expected_revision);
  end if;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
