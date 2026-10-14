-- Keep the existing authorized snapshot and enrich only the returned people.
alter function public.ops_snapshot() rename to ops_snapshot_base;
alter function public.ops_snapshot_base() set schema ops_private;
revoke all on function ops_private.ops_snapshot_base() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_base();
  return jsonb_set(snapshot,'{people}',coalesce((
    select jsonb_agg(e || jsonb_build_object('email',coalesce(i.email,''),'login',
      exists(select 1 from public.profiles p where p.person_id=(e->>'id')::integer)) order by (e->>'id')::integer)
    from jsonb_array_elements(snapshot->'people') e
    left join public.access_invites i on i.person_id=(e->>'id')::integer
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

create function public.ops_save_person(target_person_id integer, person jsonb, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  normalized_email text := nullif(lower(btrim(person->>'email')),'');
  v_type text := person->>'acct';
  v_revision integer;
  saved_id integer;
begin
  if auth.uid() is null or not ops_private.is_admin() then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  select s.revision into v_revision from public.ops_state s where s.id=1 for update;
  if expected_revision is null or v_revision <> expected_revision then
    raise exception 'Another user changed the data. Reopen the record before saving.' using errcode='40001';
  end if;
  if normalized_email is not null and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if exists(select 1 from public.access_invites i where i.email=normalized_email
    and (target_person_id is null or i.person_id is distinct from target_person_id)) then
    raise exception 'That email already belongs to another account.';
  end if;
  if exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where lower(u.email)=normalized_email and (p.role='admin' or target_person_id is null or p.person_id is distinct from target_person_id)) then
    raise exception 'That email already belongs to another account.';
  end if;
  if exists(select 1 from public.profiles where person_id=target_person_id and role='admin') then
    raise exception 'Administrator accounts must be managed separately.';
  end if;
  if target_person_id is null then
    insert into public.people(name,title,account_type,phone,map_access)
      values(btrim(person->>'n'),coalesce(person->>'r',''),v_type,coalesce(person->>'phone',''),coalesce((person->>'map')::boolean,false))
      returning id into saved_id;
  else
    update public.people set name=btrim(person->>'n'),title=coalesce(person->>'r',''),
      account_type=v_type,phone=coalesce(person->>'phone',''),map_access=coalesce((person->>'map')::boolean,false)
      where id=target_person_id and not archived returning id into saved_id;
    if saved_id is null then raise exception 'Person no longer exists or has been archived.'; end if;
  end if;
  -- Changing or removing an email revokes only this person's previous access.
  delete from public.profiles p where p.person_id=saved_id and p.role<>'admin'
    and not exists(select 1 from auth.users u where u.id=p.user_id and lower(u.email)=normalized_email);
  delete from public.access_invites where person_id=saved_id;
  if normalized_email is not null then
    insert into public.access_invites(email,role,person_id) values(normalized_email,v_type,saved_id);
    insert into public.profiles(user_id,role,person_id)
      select u.id,v_type,saved_id from auth.users u where lower(u.email)=normalized_email
      on conflict(user_id) do update set role=excluded.role,person_id=excluded.person_id;
  end if;
  insert into public.activity_log(actor_id,action,details)
    values(auth.uid(),case when target_person_id is null then 'Added person' else 'Updated person' end,
      jsonb_build_object('person_id',saved_id,'name',person->>'n','email',normalized_email,'role',v_type));
  update public.ops_state set revision=revision+1 where id=1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_save_person(integer,jsonb,integer) from public, anon;
grant execute on function public.ops_save_person(integer,jsonb,integer) to authenticated;

-- Provision from the roster's current type and exclude archived people.
create or replace function ops_private.provision_user() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id,role,person_id)
    select new.id,case when i.role='admin' then 'admin' else e.account_type end,i.person_id
    from public.access_invites i left join public.people e on e.id=i.person_id
    where i.email=lower(new.email) and (i.role='admin' or not e.archived)
    on conflict(user_id) do nothing;
  return new;
end;
$$;
