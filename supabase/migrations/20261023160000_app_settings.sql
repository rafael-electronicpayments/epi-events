-- 2026-10-23 owner request: App settings (Manage > App settings, admins only). Marketing changes the app's name,
-- Home Screen name, one-line tagline, and icon from the app, year over year, with no code change.
-- The name and tagline show in the web/phone header, the sign-in screen, the browser tab, and under the welcome
-- splash. The icon is the phone's Home Screen icon and the notification icon.
-- Only these branding values are public (they're needed before sign-in and by phones installing the app).
-- Run exactly once.

create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  name text not null default 'Impact Event Ops' check (length(btrim(name)) between 1 and 40),
  short_name text not null default 'Event Ops' check (length(short_name) <= 12),
  tagline text not null default '' check (length(tagline) <= 120),
  icon_id text check (icon_id ~ '^[A-Za-z0-9-]{8,64}$'),
  icon_bg text not null default '#ffffff' check (icon_bg ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);
insert into public.app_settings(id) values (1);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- Public icon files: "<icon id>/<size>.png" (180 Apple, 192, 512, maskable-512). Admins upload and delete.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('app-icons', 'app-icons', true, 2097152, array['image/png'])
      on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy app_icons_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'app-icons' and ops_private.is_admin())$p$;
    execute $p$create policy app_icons_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'app-icons' and ops_private.is_admin())$p$;
  end if;
end;
$$;

-- The public branding values, callable before sign-in.
create function public.app_branding() returns jsonb language sql stable
security definer set search_path = '' as $$
  select jsonb_build_object('name', s.name, 'short', s.short_name, 'tagline', s.tagline, 'icon', s.icon_id, 'bg', s.icon_bg,
    'v', extract(epoch from s.updated_at)::bigint)
  from public.app_settings s where s.id = 1;
$$;
revoke all on function public.app_branding() from public;
grant execute on function public.app_branding() to anon, authenticated;

-- Snapshot: everything from before, plus "branding" for everyone signed in.
alter function public.ops_snapshot() rename to ops_snapshot_v11;
alter function public.ops_snapshot_v11() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v11() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
begin
  return ops_private.ops_snapshot_v11() || jsonb_build_object('branding', public.app_branding());
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: setBranding [{name, short, tagline, bg, icon?}] (admins only). "icon": an uploaded icon id, or null for
-- the default icon; leave it out to keep the current icon. Everything else goes to the previous command function.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v11;
alter function public.ops_command_v11(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v11(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; o jsonb; icon text; uploaded boolean;
begin
  if action <> 'setBranding' then
    return ops_private.ops_command_v11(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  o := args->0;
  if jsonb_typeof(o) <> 'object' then raise exception 'Invalid settings.'; end if;
  if length(btrim(coalesce(o->>'name', ''))) not between 1 and 40 then raise exception 'Enter an app name of up to 40 characters.'; end if;
  if length(btrim(coalesce(o->>'short', ''))) > 12 then raise exception 'The Home Screen name can be up to 12 characters.'; end if;
  if length(btrim(coalesce(o->>'tagline', ''))) > 120 then raise exception 'The tagline can be up to 120 characters.'; end if;
  if coalesce(o->>'bg', '#ffffff') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Choose an icon background color.'; end if;
  if o ? 'icon' and jsonb_typeof(o->'icon') <> 'null' then
    icon := o->>'icon';
    if icon !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'Invalid icon.'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where bucket_id = ''app-icons'' and name = $1)' into uploaded using icon || '/192.png';
      if not uploaded then raise exception 'The icon was not uploaded. Try again.'; end if;
    end if;
  end if;
  update public.app_settings set name = btrim(o->>'name'),
      short_name = coalesce(nullif(btrim(coalesce(o->>'short', '')), ''), left(btrim(o->>'name'), 12)),
      tagline = btrim(coalesce(o->>'tagline', '')), icon_bg = lower(coalesce(o->>'bg', icon_bg)),
      icon_id = case when o ? 'icon' then icon else icon_id end, updated_at = now()
    where id = 1;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
