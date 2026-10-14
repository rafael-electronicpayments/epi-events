create schema if not exists ops_private;
revoke all on schema ops_private from public, anon, authenticated;

create table public.people (
  id integer generated always as identity (minvalue 0 start with 0) primary key,
  name text not null check (length(btrim(name)) > 0),
  title text not null default '',
  account_type text not null check (account_type in ('staff','contractor')),
  phone text not null default '',
  map_access boolean not null default false,
  archived boolean not null default false
);
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','staff','contractor')),
  person_id integer unique references public.people(id),
  check (role = 'admin' or person_id is not null)
);
create table public.events (
  id integer generated always as identity primary key,
  name text not null check (length(btrim(name)) > 0),
  start_date date not null,
  days integer not null check (days between 1 and 14)
);
create table public.rooms (
  id integer generated always as identity primary key,
  name text not null unique check (length(btrim(name)) > 0)
);
create table public.activities (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  room_id integer not null references public.rooms(id),
  title text not null check (length(btrim(title)) > 0),
  day integer not null check (day between 0 and 13),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute between 1 and 1440),
  staff_needed integer not null check (staff_needed > 0),
  check (end_minute > start_minute)
);
create table public.assignments (
  id integer generated always as identity primary key,
  person_id integer not null references public.people(id),
  activity_id integer not null references public.activities(id) on delete cascade,
  acknowledged boolean not null default false,
  checked_in boolean not null default false,
  confirmed boolean not null default false,
  tag text not null default 'new' check (tag in ('new','changed','')),
  sequence integer not null default 0,
  calendar_sequence integer,
  calendar_prompt boolean not null default false,
  unique (person_id, activity_id),
  check (not checked_in or acknowledged)
);
create table public.notifications (
  id integer generated always as identity primary key,
  person_id integer not null references public.people(id),
  assignment_id integer references public.assignments(id) on delete set null,
  message text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
create table public.ops_state (
  id integer primary key check (id = 1),
  revision integer not null default 0
);
insert into public.ops_state(id) values (1);

create index activities_event_id_idx on public.activities(event_id);
create index activities_room_id_idx on public.activities(room_id);
create index assignments_activity_id_idx on public.assignments(activity_id);
create index notifications_person_id_idx on public.notifications(person_id);
create index notifications_assignment_id_idx on public.notifications(assignment_id);
create index activity_log_actor_id_idx on public.activity_log(actor_id);

-- These helpers bypass RLS only to resolve the caller's trusted profile.
create function ops_private.is_admin() returns boolean language sql stable
security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where user_id = auth.uid() and role = 'admin');
$$;
create function ops_private.person_id() returns integer language sql stable
security definer set search_path = '' as $$
  select p.person_id from public.profiles p join public.people e on e.id = p.person_id
  where p.user_id = auth.uid() and not e.archived;
$$;
grant usage on schema ops_private to authenticated;
revoke all on function ops_private.is_admin(), ops_private.person_id() from public, anon;
grant execute on function ops_private.is_admin(), ops_private.person_id() to authenticated;

alter table public.people enable row level security;
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.rooms enable row level security;
alter table public.activities enable row level security;
alter table public.assignments enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log enable row level security;
alter table public.ops_state enable row level security;
create policy people_read on public.people for select to authenticated using (ops_private.is_admin() or id = ops_private.person_id());
create policy profiles_read on public.profiles for select to authenticated using (user_id = auth.uid() or ops_private.is_admin());
create policy assignments_read on public.assignments for select to authenticated using (ops_private.is_admin() or person_id = ops_private.person_id());
create policy notifications_read on public.notifications for select to authenticated using (ops_private.is_admin() or person_id = ops_private.person_id());
create policy activities_read on public.activities for select to authenticated using (
  ops_private.is_admin() or exists(select 1 from public.assignments a where a.activity_id = activities.id and a.person_id = ops_private.person_id())
);
create policy events_read on public.events for select to authenticated using (
  ops_private.is_admin() or exists(select 1 from public.activities a where a.event_id = events.id)
);
create policy rooms_read on public.rooms for select to authenticated using (
  ops_private.is_admin() or exists(select 1 from public.activities a where a.room_id = rooms.id)
);
create policy log_read on public.activity_log for select to authenticated using (ops_private.is_admin());
create policy state_read on public.ops_state for select to authenticated using (exists(select 1 from public.profiles where user_id = auth.uid()));
-- Mutations go through a transaction, never through unrestricted table writes.
revoke all on public.people, public.profiles, public.events, public.rooms, public.activities,
  public.assignments, public.notifications, public.activity_log, public.ops_state from anon, authenticated;
grant select on public.people, public.profiles, public.events, public.rooms, public.activities,
  public.assignments, public.notifications, public.activity_log, public.ops_state to authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare p public.profiles; admin boolean; pid integer;
begin
  select * into p from public.profiles where user_id = auth.uid();
  if p.user_id is null then raise exception 'Your account has not been provisioned for Event Ops.' using errcode = '42501'; end if;
  admin := p.role = 'admin';
  pid := ops_private.person_id();
  if not admin and pid is null then raise exception 'Your roster access has been disabled.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'revision', (select revision from public.ops_state where id = 1),
    'role', p.role, 'me', pid,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'role', e.title,
      'acct', e.account_type, 'phone', case when admin then e.phone else '' end,
      'map', e.map_access::integer, 'gone', e.archived::integer) order by e.id)
      from public.people e where admin or e.id = pid), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'start', e.start_date, 'days', e.days) order by e.id)
      from public.events e where admin or exists(select 1 from public.activities s join public.assignments a on a.activity_id = s.id where s.event_id = e.id and a.person_id = pid)), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(r.name order by r.id) from public.rooms r where admin or exists(
      select 1 from public.activities s join public.assignments a on a.activity_id = s.id where s.room_id = r.id and a.person_id = pid)), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'ev', s.event_id, 'd', s.day,
      't', s.title, 'r', r.name, 'a', s.start_minute, 'b', s.end_minute, 'n', s.staff_needed) order by s.id)
      from public.activities s join public.rooms r on r.id = s.room_id where admin or exists(select 1 from public.assignments a where a.activity_id = s.id and a.person_id = pid)), '[]'::jsonb),
    'asg', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'e', a.person_id, 's', a.activity_id,
      'ack', a.acknowledged::integer, 'in', a.checked_in::integer, 'conf', a.confirmed::integer,
      'tag', a.tag, 'seq', a.sequence, 'cal', a.calendar_sequence, 'pc', a.calendar_prompt::integer) order by a.id)
      from public.assignments a where admin or a.person_id = pid), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'e', n.person_id, 'aid', n.assignment_id,
      'done', n.done::integer, 'x', n.message) order by n.id) from public.notifications n where admin or n.person_id = pid), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('t', l.created_at, 'x', l.action, 'details', l.details) order by l.id desc)
      from (select * from public.activity_log order by id desc limit 200) l where admin), '[]'::jsonb)
  );
end;
$$;

create function ops_private.notify_assignment(aid integer, label text) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set done = true where assignment_id = aid;
  insert into public.notifications(person_id, assignment_id, message)
    select a.person_id, a.id, label || ': ' || s.title || ', ' || r.name || ' (Day ' || (s.day + 1) || ')'
    from public.assignments a join public.activities s on s.id = a.activity_id join public.rooms r on r.id = s.room_id where a.id = aid;
$$;
revoke all on function ops_private.notify_assignment(integer, text) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles; v integer; a public.assignments; s public.activities;
  target integer; room integer; eid integer; rec record; obj jsonb; label text;
begin
  select * into p from public.profiles where user_id = auth.uid();
  if p.user_id is null then raise exception 'Access denied.' using errcode = '42501'; end if;
  if p.role <> 'admin' and ops_private.person_id() is null then raise exception 'Roster access disabled.' using errcode = '42501'; end if;
  if p.role <> 'admin' and action not in ('ack','checkIn','dismiss','calAdd','calSkip') then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;
  if action in ('ack','checkIn','confirm','move','remove','calAdd','calSkip') then
    select * into a from public.assignments where id = (args->>0)::integer;
    if a.id is null then raise exception 'Assignment no longer exists.'; end if;
    if p.role <> 'admin' and a.person_id <> p.person_id then raise exception 'Access denied.' using errcode = '42501'; end if;
  end if;
  case action
    when 'addEvent' then
      obj := args->0;
      insert into public.events(name,start_date,days) values(btrim(obj->>'n'),(obj->>'b')::date,(obj->>'d')::integer);
    when 'editEvent' then
      target := (args->>0)::integer; obj := args->1;
      if exists(select 1 from public.activities where event_id = target and day >= (obj->>'d')::integer) then raise exception 'Move or delete activities outside the new event dates first.'; end if;
      update public.events set name = btrim(obj->>'n'), start_date = (obj->>'b')::date, days = (obj->>'d')::integer where id = target;
      for rec in select a0.id from public.assignments a0 join public.activities s0 on s0.id = a0.activity_id where s0.event_id = target loop
        update public.assignments set acknowledged = false, checked_in = false, confirmed = false, tag = 'changed', sequence = sequence + 1, calendar_prompt = false where id = rec.id;
        perform ops_private.notify_assignment(rec.id, 'Event changed');
      end loop;
    when 'delEvent' then
      target := (args->>0)::integer;
      if (select count(*) from public.events) < 2 then raise exception 'At least one event must remain.'; end if;
      insert into public.notifications(person_id,message)
        select distinct a0.person_id,'Event removed: ' || e.name from public.events e join public.activities s0 on s0.event_id=e.id join public.assignments a0 on a0.activity_id=s0.id where e.id=target;
      delete from public.events where id = target;
    when 'addStaff' then
      obj := args->0;
      insert into public.people(name,title,account_type,phone,map_access) values(btrim(obj->>'n'),coalesce(obj->>'r',''),obj->>'acct',coalesce(obj->>'phone',''),(obj->>'map')::boolean);
    when 'editStaff' then
      target := (args->>0)::integer; obj := args->1;
      update public.people set name=btrim(obj->>'n'),title=coalesce(obj->>'r',''),account_type=obj->>'acct',phone=coalesce(obj->>'phone',''),map_access=(obj->>'map')::boolean where id=target;
      update public.profiles set role=obj->>'acct' where person_id=target and role <> 'admin';
    when 'delStaff' then
      target := (args->>0)::integer;
      update public.people set archived=true where id=target;
      delete from public.assignments where person_id=target;
      delete from public.notifications where person_id=target;
    when 'addRoom' then insert into public.rooms(name) values(btrim(args->>0));
    when 'editRoom' then
      update public.rooms set name=btrim(args->>1) where name=args->>0;
      for rec in select a0.id from public.assignments a0 join public.activities s0 on s0.id=a0.activity_id join public.rooms r on r.id=s0.room_id where r.name=btrim(args->>1) loop
        update public.assignments set acknowledged=false,checked_in=false,confirmed=false,tag='changed',sequence=sequence+1,calendar_prompt=false where id=rec.id;
        perform ops_private.notify_assignment(rec.id,'Room changed');
      end loop;
    when 'delRoom' then delete from public.rooms where name=args->>0;
    when 'addSession', 'editSession' then
      if action='editSession' then target:=(args->>0)::integer; args:=args - 0; end if;
      select id into room from public.rooms where name=args->>1;
      if action='addSession' then eid:=(args->>6)::integer;
      else select event_id into eid from public.activities where id=target; end if;
      if not exists(select 1 from public.events where id=eid and (args->>2)::integer between 0 and days-1) then raise exception 'Choose a day within the event.'; end if;
      if action='addSession' then
        insert into public.activities(event_id,room_id,title,day,start_minute,end_minute,staff_needed)
          values(eid,room,btrim(args->>0),(args->>2)::integer,(args->>3)::integer,(args->>4)::integer,(args->>5)::integer);
      else
        select * into s from public.activities where id=target;
        update public.activities set room_id=room,title=btrim(args->>0),day=(args->>2)::integer,start_minute=(args->>3)::integer,end_minute=(args->>4)::integer,staff_needed=(args->>5)::integer where id=target;
        if (s.room_id,s.title,s.day,s.start_minute,s.end_minute) is distinct from (room,btrim(args->>0),(args->>2)::integer,(args->>3)::integer,(args->>4)::integer) then
          for rec in select id from public.assignments where activity_id=target loop
            update public.assignments set acknowledged=false,checked_in=false,confirmed=false,tag='changed',sequence=sequence+1,calendar_prompt=false where id=rec.id;
            perform ops_private.notify_assignment(rec.id,'Activity changed');
          end loop;
        end if;
      end if;
    when 'delSession' then
      target:=(args->>0)::integer;
      insert into public.notifications(person_id,message) select a0.person_id,'Activity cancelled: ' || s0.title from public.assignments a0 join public.activities s0 on s0.id=a0.activity_id where s0.id=target;
      delete from public.activities where id=target;
    when 'assign' then
      if not exists(select 1 from public.people where id=(args->>0)::integer and not archived) then raise exception 'Choose an active person.'; end if;
      insert into public.assignments(person_id,activity_id) values((args->>0)::integer,(args->>1)::integer) returning id into target;
      perform ops_private.notify_assignment(target,'New assignment');
    when 'move' then
      update public.assignments set activity_id=(args->>1)::integer,acknowledged=false,checked_in=false,confirmed=false,tag='changed',sequence=sequence+1,calendar_prompt=false where id=a.id;
      perform ops_private.notify_assignment(a.id,'Changed assignment');
    when 'remove' then
      insert into public.notifications(person_id,message) select a.person_id,'Removed from: ' || title from public.activities where id=a.activity_id;
      delete from public.assignments where id=a.id;
    when 'ack' then
      update public.assignments set acknowledged=true,calendar_prompt=true where id=a.id;
      update public.notifications set done=true where assignment_id=a.id;
    when 'checkIn' then
      if not a.acknowledged then raise exception 'Acknowledge the assignment before checking in.'; end if;
      update public.assignments set checked_in=true where id=a.id;
    when 'confirm' then update public.assignments set confirmed=true where id=a.id;
    when 'dismiss' then
      target:=(args->>0)::integer;
      if not exists(select 1 from public.notifications where id=target and (p.role='admin' or person_id=p.person_id)) then raise exception 'Access denied.' using errcode='42501'; end if;
      update public.notifications set done=true where id=target;
    when 'calAdd' then update public.assignments set calendar_sequence=sequence,calendar_prompt=false where id=a.id;
    when 'calSkip' then update public.assignments set calendar_prompt=false where id=a.id;
    else raise exception 'Unsupported action: %',action;
  end case;
  insert into public.activity_log(actor_id,action,details) values(auth.uid(),action,args);
  update public.ops_state set revision=revision+1 where id=1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_snapshot(), public.ops_command(text,jsonb,integer) from public, anon;
grant execute on function public.ops_snapshot(), public.ops_command(text,jsonb,integer) to authenticated;
