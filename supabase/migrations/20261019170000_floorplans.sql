-- 2026-10-19 owner request: connected floorplans. Several PDFs per event, stored in a private Storage bucket.
-- Admins upload, rename, move, and delete them; people with venue map access (people.map_access) can view them.

create table public.floorplans (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  path text not null unique,
  size integer not null check (size between 1 and 26214400),
  created_at timestamptz not null default now()
);
create index floorplans_event_idx on public.floorplans(event_id);

create function ops_private.can_view_floorplans() returns boolean language sql stable
security definer set search_path = '' as $$
  select coalesce(ops_private.is_admin(), false)
    or exists(select 1 from public.people e where e.id = ops_private.person_id() and e.map_access and not e.archived);
$$;
revoke all on function ops_private.can_view_floorplans() from public, anon;
grant execute on function ops_private.can_view_floorplans() to authenticated;

alter table public.floorplans enable row level security;
create policy floorplans_read on public.floorplans for select to authenticated using (ops_private.can_view_floorplans());
revoke all on public.floorplans from anon, authenticated;
grant select on public.floorplans to authenticated;

-- Private bucket and object rules (skipped where Supabase Storage is not installed, e.g. local PGlite tests).
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('floorplans', 'floorplans', false, 26214400, array['application/pdf'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy floorplans_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'floorplans' and ops_private.is_admin())$p$;
    execute $p$create policy floorplans_viewer_select on storage.objects for select to authenticated
      using (bucket_id = 'floorplans' and ops_private.can_view_floorplans())$p$;
    execute $p$create policy floorplans_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'floorplans' and ops_private.is_admin()) with check (bucket_id = 'floorplans' and ops_private.is_admin())$p$;
    execute $p$create policy floorplans_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'floorplans' and ops_private.is_admin())$p$;
  end if;
end;
$$;

-- Snapshot: everything from before, plus floorplans for admins and for people with map access.
create or replace function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_roles();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object(
    'roomAck', coalesce((select jsonb_object_agg(r.name, r.requires_ack) from public.rooms r
      where snapshot->'rooms' ? r.name), '{}'::jsonb),
    'actAck', coalesce((select jsonb_object_agg(s.id::text, s.requires_ack) from public.activities s
      where s.requires_ack is not null and s.id in (select (x->>'id')::integer from jsonb_array_elements(snapshot->'activities') x)), '{}'::jsonb),
    'breaks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'e', b.person_id, 'ev', b.event_id, 'd', b.day,
        'k', b.kind, 'a', b.start_minute, 'b', b.end_minute) order by b.day, b.start_minute, b.id)
      from public.breaks b join public.people e on e.id = b.person_id join public.events ev on ev.id = b.event_id
      where not e.archived and b.day < ev.days and (admin or b.person_id = pid)), '[]'::jsonb),
    'clocks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'e', c.person_id, 'k', c.kind, 'bid', c.break_id,
        'out', c.out_at, 'in', c.in_at) order by c.out_at desc)
      from public.clocks c where (admin or c.person_id = pid) and (c.in_at is null or c.out_at > now() - interval '3 days')), '[]'::jsonb),
    'floorplans', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ev', f.event_id, 'name', f.name, 'path', f.path, 'size', f.size)
        order by f.event_id, f.id)
      from public.floorplans f where ops_private.can_view_floorplans()
        and (admin or f.event_id in (select (x->>'id')::integer from jsonb_array_elements(snapshot->'events') x))), '[]'::jsonb));
end;
$$;

-- Commands: floorplan actions are handled here; everything else goes to the previous command function unchanged.
--   addFloorplan [eventId, name, path, size]   renameFloorplan [id, name]   moveFloorplan [id, eventId]   delFloorplan [id]
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v2;
alter function public.ops_command_v2(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v2(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; uploaded boolean;
begin
  if action not in ('addFloorplan', 'renameFloorplan', 'moveFloorplan', 'delFloorplan') then
    return ops_private.ops_command_v2(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  case action
    when 'addFloorplan' then
      if not exists(select 1 from public.events where id = (args->>0)::integer) then raise exception 'Choose an event.'; end if;
      if coalesce(btrim(args->>1), '') = '' then raise exception 'Enter a floorplan name.'; end if;
      if coalesce(args->>2, '') !~ ('^' || (args->>0)::integer || '/[A-Za-z0-9-]+\.pdf$') then raise exception 'Invalid file location.'; end if;
      if to_regclass('storage.objects') is not null then
        execute 'select exists(select 1 from storage.objects where bucket_id = ''floorplans'' and name = $1)' into uploaded using args->>2;
        if not uploaded then raise exception 'The PDF was not uploaded. Try again.'; end if;
      end if;
      insert into public.floorplans(event_id, name, path, size)
        values((args->>0)::integer, btrim(args->>1), args->>2, (args->>3)::integer);
    when 'renameFloorplan' then
      if coalesce(btrim(args->>1), '') = '' then raise exception 'Enter a floorplan name.'; end if;
      update public.floorplans set name = btrim(args->>1) where id = (args->>0)::integer;
      if not found then raise exception 'Floorplan no longer exists.'; end if;
    when 'moveFloorplan' then
      if not exists(select 1 from public.events where id = (args->>1)::integer) then raise exception 'Choose an event.'; end if;
      update public.floorplans set event_id = (args->>1)::integer where id = (args->>0)::integer;
      if not found then raise exception 'Floorplan no longer exists.'; end if;
    when 'delFloorplan' then
      delete from public.floorplans where id = (args->>0)::integer;
      if not found then raise exception 'Floorplan no longer exists.'; end if;
  end case;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
