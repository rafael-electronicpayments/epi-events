-- 2026-10-21 owner request: each event can have a logo, shown to the right of the module heading.
-- Admins upload, replace, or remove it in Event setup. The app resizes the image (at most 400 px on its longest side)
-- and stores it as a PNG (or WebP) in the private Storage bucket "event-logos" under "<event id>/".
-- Anyone signed in can view the logo of an event that is open to them; admins see all. Run exactly once.

alter table public.events
  add column logo_path text unique,
  add column logo_type text check (logo_type in ('image/png', 'image/webp')),
  add constraint events_logo_pair check ((logo_path is null) = (logo_type is null));

do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('event-logos', 'event-logos', false, 2097152, array['image/png', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy event_logos_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'event-logos' and ops_private.is_admin())$p$;
    execute $p$create policy event_logos_select on storage.objects for select to authenticated
      using (bucket_id = 'event-logos' and (ops_private.is_admin()
        or (split_part(name, '/', 1) ~ '^\d+$' and ops_private.event_open(split_part(name, '/', 1)::integer))))$p$;
    execute $p$create policy event_logos_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'event-logos' and ops_private.is_admin())$p$;
  end if;
end;
$$;

-- Snapshot: everything from before, plus each event's logo ("logo" path and "logoType"), and "logos": true so the
-- app knows this database supports logos.
alter function public.ops_snapshot() rename to ops_snapshot_v5;
alter function public.ops_snapshot_v5() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v5() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v5();
  return snapshot || jsonb_build_object('logos', true,
    'events', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('logo', e.logo_path, 'logoType', e.logo_type)
        from public.events e where e.id = (x->>'id')::integer and e.logo_path is not null), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'events') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: setEventLogo [eventId, path, type] sets the logo; setEventLogo [eventId, null] removes it (admins only).
-- Everything else goes to the previous command function unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v6;
alter function public.ops_command_v6(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v6(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; lp text; lt text; uploaded boolean;
begin
  if action <> 'setEventLogo' then
    return ops_private.ops_command_v6(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  eid := (args->>0)::integer;
  if not exists(select 1 from public.events where id = eid) then raise exception 'Event no longer exists.'; end if;
  lp := nullif(args->>1, '');
  lt := case when lp is null then null else args->>2 end;
  if lp is not null then
    if lt is null or lt not in ('image/png', 'image/webp') then raise exception 'Logos must be a PNG or WebP image.'; end if;
    if lp !~ ('^' || eid || '/[A-Za-z0-9-]+\.(png|webp)$') then raise exception 'Invalid logo location.'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where bucket_id = ''event-logos'' and name = $1)' into uploaded using lp;
      if not uploaded then raise exception 'The logo was not uploaded. Try again.'; end if;
    end if;
  end if;
  update public.events set logo_path = lp, logo_type = lt where id = eid;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
