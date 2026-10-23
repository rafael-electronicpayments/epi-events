-- 2026-10-21 owner request: Documents. Each event has its own documents. Only admins add, edit, or delete them, and
-- choose per document who can view and download it: everyone on the event, or selected people. Files live in the
-- private Storage bucket "documents" under "<event id>/". Run exactly once.

create table public.documents (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  path text not null unique,
  size integer not null check (size between 1 and 26214400),
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv', 'text/plain')),
  everyone boolean not null default true,
  created_at timestamptz not null default now()
);
create index documents_event_idx on public.documents(event_id);

-- When a document is not for everyone, these people can view it.
create table public.document_access (
  document_id integer not null references public.documents(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  primary key (document_id, person_id)
);
create index document_access_person_idx on public.document_access(person_id);

-- A non-admin can view a document when its event is open, they are assigned in that event, and the document is
-- for everyone or they were selected.
create function ops_private.can_view_document(did integer) returns boolean language sql stable
security definer set search_path = '' as $$
  select exists(select 1 from public.documents d
    where d.id = did and ops_private.event_open(d.event_id)
      and exists(select 1 from public.assignments a join public.activities s on s.id = a.activity_id
        where s.event_id = d.event_id and a.person_id = ops_private.person_id())
      and (d.everyone or exists(select 1 from public.document_access x where x.document_id = d.id and x.person_id = ops_private.person_id())));
$$;
revoke all on function ops_private.can_view_document(integer) from public, anon;
grant execute on function ops_private.can_view_document(integer) to authenticated;

alter table public.documents enable row level security;
alter table public.document_access enable row level security;
create policy documents_read on public.documents for select to authenticated
  using (ops_private.is_admin() or ops_private.can_view_document(id));
create policy document_access_read on public.document_access for select to authenticated
  using (ops_private.is_admin());
revoke all on public.documents, public.document_access from anon, authenticated;
grant select on public.documents, public.document_access to authenticated;

-- Private bucket: admins upload and delete; viewers download only documents they can view.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('documents', 'documents', false, 26214400, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv', 'text/plain'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy documents_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and ops_private.is_admin())$p$;
    execute $p$create policy documents_viewer_select on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (ops_private.is_admin()
        or exists(select 1 from public.documents d where d.path = name and ops_private.can_view_document(d.id))))$p$;
    execute $p$create policy documents_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'documents' and ops_private.is_admin())$p$;
  end if;
end;
$$;

-- Snapshot: everything from before, plus "documents": admins get every document with its viewer list ("who");
-- everyone else gets only the documents they can view.
alter function public.ops_snapshot() rename to ops_snapshot_v7;
alter function public.ops_snapshot_v7() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v7() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean;
begin
  snapshot := ops_private.ops_snapshot_v7();
  admin := snapshot->>'role' = 'admin';
  return snapshot || jsonb_build_object('documents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'ev', d.event_id, 'name', d.name, 'path', d.path, 'size', d.size, 'type', d.mime, 'all', d.everyone)
      || case when admin then jsonb_build_object('who', coalesce((select jsonb_agg(x.person_id order by x.person_id)
        from public.document_access x where x.document_id = d.id), '[]'::jsonb)) else '{}'::jsonb end
      order by d.event_id, lower(d.name), d.id)
    from public.documents d where admin or ops_private.can_view_document(d.id)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands (admins only):
--   addDocument [eventId, name, path, size, type, everyone, [personId...]]
--   editDocument [id, name, everyone, [personId...]]      delDocument [id]
-- Everything else goes to the previous command function unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v8;
alter function public.ops_command_v8(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v8(text, jsonb, integer) from public, anon, authenticated;

create function ops_private.document_viewers(did integer, for_all boolean, who jsonb) returns void language plpgsql
security definer set search_path = '' as $$
declare ids integer[];
begin
  if jsonb_typeof(coalesce(who, '[]'::jsonb)) <> 'array' then raise exception 'Choose who can view this document.'; end if;
  ids := coalesce((select array_agg(distinct (v #>> '{}')::integer) from jsonb_array_elements(coalesce(who, '[]'::jsonb)) v), '{}');
  if not for_all and cardinality(ids) = 0 then raise exception 'Choose at least one person, or let everyone view it.'; end if;
  if exists(select 1 from unnest(ids) i where not exists(select 1 from public.people p where p.id = i and not p.archived)) then
    raise exception 'Choose active people only.';
  end if;
  delete from public.document_access where document_id = did;
  if not for_all then
    insert into public.document_access(document_id, person_id) select did, i from unnest(ids) i;
  end if;
end;
$$;
revoke all on function ops_private.document_viewers(integer, boolean, jsonb) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; did integer; p text; t text; uploaded boolean; for_all boolean;
begin
  if action not in ('addDocument', 'editDocument', 'delDocument') then
    return ops_private.ops_command_v8(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  if action = 'addDocument' then
    eid := (args->>0)::integer;
    if not exists(select 1 from public.events where id = eid) then raise exception 'Event no longer exists.'; end if;
    p := args->>2; t := args->>4; for_all := coalesce((args->>5)::boolean, true);
    if coalesce(btrim(args->>1), '') = '' then raise exception 'Enter a document name.'; end if;
    if p is null or p !~ ('^' || eid || '/[A-Za-z0-9-]+\.[a-z0-9]{1,5}$') then raise exception 'Invalid document location.'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where bucket_id = ''documents'' and name = $1)' into uploaded using p;
      if not uploaded then raise exception 'The document was not uploaded. Try again.'; end if;
    end if;
    insert into public.documents(event_id, name, path, size, mime, everyone)
      values(eid, btrim(args->>1), p, (args->>3)::integer, t, for_all) returning id into did;
    perform ops_private.document_viewers(did, for_all, args->6);
  else
    did := (args->>0)::integer;
    if not exists(select 1 from public.documents where id = did) then raise exception 'Document no longer exists.'; end if;
    if action = 'editDocument' then
      if coalesce(btrim(args->>1), '') = '' then raise exception 'Enter a document name.'; end if;
      for_all := coalesce((args->>2)::boolean, true);
      update public.documents set name = btrim(args->>1), everyone = for_all where id = did;
      perform ops_private.document_viewers(did, for_all, args->3);
    else
      delete from public.documents where id = did;
    end if;
  end if;
  insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
