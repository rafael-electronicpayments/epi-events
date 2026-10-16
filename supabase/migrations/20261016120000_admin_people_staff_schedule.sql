-- 2026-10-16 owner requests:
-- 1. People can be typed Admin. Admin roster people get full administrator access.
-- 2. Staff (not contractors) can view the full event schedule. Contractors keep their own schedule only.
-- 3. Notifications name the weekday and date instead of "Day N".

alter table public.people drop constraint people_account_type_check;
alter table public.people add constraint people_account_type_check check (account_type in ('admin','staff','contractor'));

create or replace function ops_private.notify_assignment(aid integer, label text) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set done = true where assignment_id = aid;
  insert into public.notifications(person_id, assignment_id, message)
    select a.person_id, a.id, label || ': ' || s.title || ', ' || r.name || ' (' || to_char(e.start_date + s.day, 'FMDay, Mon FMDD') || ')'
    from public.assignments a join public.activities s on s.id = a.activity_id join public.rooms r on r.id = s.room_id
    join public.events e on e.id = s.event_id where a.id = aid;
$$;

-- Staff receive every activity and assignment for schedule viewing, plus roster names only.
-- Phone numbers, emails, login status, notifications, and the activity log stay restricted.
create or replace function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_base();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  if snapshot->>'role' = 'staff' then
    snapshot := snapshot || jsonb_build_object(
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'role', e.title,
        'acct', e.account_type, 'phone', '', 'map', case when e.id = pid then e.map_access::integer else 0 end,
        'gone', e.archived::integer) order by e.id) from public.people e where not e.archived or e.id = pid), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'start', e.start_date, 'days', e.days) order by e.id)
        from public.events e), '[]'::jsonb),
      'rooms', coalesce((select jsonb_agg(r.name order by r.id) from public.rooms r), '[]'::jsonb),
      'activities', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'ev', s.event_id, 'd', s.day,
        't', s.title, 'r', r.name, 'a', s.start_minute, 'b', s.end_minute, 'n', s.staff_needed) order by s.id)
        from public.activities s join public.rooms r on r.id = s.room_id), '[]'::jsonb),
      'asg', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'e', a.person_id, 's', a.activity_id,
        'ack', a.acknowledged::integer, 'in', a.checked_in::integer, 'conf', a.confirmed::integer,
        'tag', a.tag, 'seq', a.sequence, 'cal', a.calendar_sequence, 'pc', a.calendar_prompt::integer) order by a.id)
        from public.assignments a), '[]'::jsonb));
  end if;
  return jsonb_set(snapshot, '{people}', coalesce((
    select jsonb_agg(e || jsonb_build_object(
      'email', case when admin or (e->>'id')::integer = pid then coalesce(i.email, '') else '' end,
      'login', case when admin or (e->>'id')::integer = pid then exists(select 1 from public.profiles p where p.person_id = (e->>'id')::integer) else false end)
      order by (e->>'id')::integer)
    from jsonb_array_elements(snapshot->'people') e
    left join public.access_invites i on i.person_id = (e->>'id')::integer
  ), '[]'::jsonb));
end;
$$;

create or replace function public.ops_save_person(target_person_id integer, person jsonb, expected_revision integer)
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
  if v_type is null or v_type not in ('admin','staff','contractor') then
    raise exception 'Choose Admin, Staff, or Contractor.';
  end if;
  if normalized_email is not null and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if exists(select 1 from public.access_invites i where i.email=normalized_email
    and (i.person_id is not null or v_type <> 'admin')
    and (target_person_id is null or i.person_id is distinct from target_person_id)) then
    raise exception 'That email already belongs to another account.';
  end if;
  if exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where lower(u.email)=normalized_email and p.person_id is not null
    and (target_person_id is null or p.person_id <> target_person_id)) then
    raise exception 'That email already belongs to another account.';
  end if;
  -- An administrator login that is not yet on the roster can be linked, but only as Admin.
  if v_type <> 'admin' and exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where lower(u.email)=normalized_email and p.role='admin'
    and (target_person_id is null or p.person_id is distinct from target_person_id)) then
    raise exception 'That email belongs to an administrator. Choose Admin as the type.';
  end if;
  -- Prevent administrators from locking themselves out.
  if target_person_id is not null and exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=auth.uid() and p.person_id=target_person_id
    and (v_type <> 'admin' or lower(u.email) is distinct from normalized_email)) then
    raise exception 'You cannot remove your own administrator access.';
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
  delete from public.profiles p where p.person_id=saved_id
    and not exists(select 1 from auth.users u where u.id=p.user_id and lower(u.email)=normalized_email);
  delete from public.access_invites where person_id=saved_id or (email=normalized_email and person_id is null);
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

-- Roster type decides the role for roster people; standalone admin invitations stay admin.
create or replace function ops_private.provision_user() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id,role,person_id)
    select new.id,coalesce(e.account_type,i.role),i.person_id
    from public.access_invites i left join public.people e on e.id=i.person_id
    where i.email=lower(new.email) and (i.person_id is null or not e.archived)
    on conflict(user_id) do nothing;
  return new;
end;
$$;

-- Archiving an Admin roster person removes their administrator access.
create function ops_private.revoke_archived_admin() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if new.archived and not old.archived then
    if exists(select 1 from public.profiles where person_id=new.id and user_id=auth.uid()) then
      raise exception 'You cannot remove your own access.';
    end if;
    delete from public.profiles where person_id=new.id and role='admin';
  end if;
  return new;
end;
$$;
revoke all on function ops_private.revoke_archived_admin() from public, anon, authenticated;
create trigger people_revoke_archived_admin after update of archived on public.people
  for each row execute function ops_private.revoke_archived_admin();
