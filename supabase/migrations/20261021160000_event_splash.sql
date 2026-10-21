-- 2026-10-21 owner request: each event can have a welcome splash image, shown for about 3 seconds right after
-- signing in (a tap closes it). Admins add, replace, preview, or remove it in Event setup. The app resizes the image
-- (at most 1600 px on its longest side) and stores it as WebP or JPEG in the private "event-logos" bucket under
-- "<event id>/", next to the logo, with the same viewing rules. Run exactly once.

alter table public.events
  add column splash_path text unique,
  add column splash_type text check (splash_type in ('image/png', 'image/webp', 'image/jpeg')),
  add constraint events_splash_pair check ((splash_path is null) = (splash_type is null));

-- The bucket now also takes JPEG (splash images on browsers that can't make WebP, e.g. older iPhones).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/webp', 'image/jpeg'] where id = 'event-logos';
  end if;
end;
$$;

-- Snapshot: everything from before, plus each event's splash ("splash" path and "splashType"), and "splashes": true.
alter function public.ops_snapshot() rename to ops_snapshot_v6;
alter function public.ops_snapshot_v6() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v6() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v6();
  return snapshot || jsonb_build_object('splashes', true,
    'events', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('splash', e.splash_path, 'splashType', e.splash_type)
        from public.events e where e.id = (x->>'id')::integer and e.splash_path is not null), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'events') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: setEventSplash [eventId, path, type] sets the splash; setEventSplash [eventId, null] removes it (admins only).
-- Everything else goes to the previous command function unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v7;
alter function public.ops_command_v7(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v7(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; sp text; st text; uploaded boolean;
begin
  if action <> 'setEventSplash' then
    return ops_private.ops_command_v7(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  eid := (args->>0)::integer;
  if not exists(select 1 from public.events where id = eid) then raise exception 'Event no longer exists.'; end if;
  sp := nullif(args->>1, '');
  st := case when sp is null then null else args->>2 end;
  if sp is not null then
    if st is null or st not in ('image/png', 'image/webp', 'image/jpeg') then raise exception 'Splash images must be PNG, WebP, or JPEG.'; end if;
    if sp !~ ('^' || eid || '/splash-[A-Za-z0-9-]+\.(png|webp|jpg)$') then raise exception 'Invalid splash location.'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where bucket_id = ''event-logos'' and name = $1)' into uploaded using sp;
      if not uploaded then raise exception 'The splash image was not uploaded. Try again.'; end if;
    end if;
  end if;
  update public.events set splash_path = sp, splash_type = st where id = eid;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
