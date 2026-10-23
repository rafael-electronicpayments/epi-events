-- 2026-10-19 owner request: scheduled lunches/breaks (per person, created for one or many people at once)
-- and clocking out/in for lunch or a break at any time. Returns after the scheduled end are flagged in the app.

create table public.breaks (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('lunch', 'break')),
  day integer not null check (day >= 0),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute > start_minute and end_minute <= 1440),
  created_at timestamptz not null default now()
);
create index breaks_event_day_idx on public.breaks(event_id, day);
create index breaks_person_idx on public.breaks(person_id);

create table public.clocks (
  id integer generated always as identity primary key,
  person_id integer not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('lunch', 'break')),
  break_id integer references public.breaks(id) on delete set null,
  out_at timestamptz not null default now(),
  in_at timestamptz,
  check (in_at is null or in_at >= out_at)
);
create unique index clocks_one_open_per_person on public.clocks(person_id) where in_at is null;
create index clocks_break_idx on public.clocks(break_id);

alter table public.breaks enable row level security;
alter table public.clocks enable row level security;
create policy breaks_read on public.breaks for select to authenticated using (ops_private.is_admin() or person_id = ops_private.person_id());
create policy clocks_read on public.clocks for select to authenticated using (ops_private.is_admin() or person_id = ops_private.person_id());
revoke all on public.breaks, public.clocks from anon, authenticated;
grant select on public.breaks, public.clocks to authenticated;

-- Snapshot: everything from before, plus breaks and recent clock events (admins: everyone; others: their own).
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
      from public.clocks c where (admin or c.person_id = pid) and (c.in_at is null or c.out_at > now() - interval '3 days')), '[]'::jsonb));
end;
$$;

-- Readable labels for notifications, e.g. "Lunch scheduled: 12:00 PM-12:30 PM (Tuesday, Mar 2)".
create function ops_private.break_label(b public.breaks, verb text) returns text language sql stable security definer set search_path = '' as $$
  select initcap(b.kind) || ' ' || verb || ': ' || to_char(time '00:00' + make_interval(mins => b.start_minute), 'FMHH12:MI AM') || '-'
    || to_char(time '00:00' + make_interval(mins => b.end_minute), 'FMHH12:MI AM') || ' ('
    || to_char(e.start_date + b.day, 'FMDay, Mon FMDD') || ')'
  from public.events e where e.id = b.event_id;
$$;
revoke all on function ops_private.break_label(public.breaks, text) from public, anon, authenticated;

-- Commands: break and clock actions are handled here; everything else is unchanged from 20261019120000.
--   addBreak [kind, day, start, end, [personIds], eventId]   editBreak [id, kind, day, start, end]   delBreak [id]
--   clockOut [kind, breakId|null]   clockIn []
create or replace function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  flag jsonb; v integer; target integer; pid integer; admin boolean; b public.breaks; k text; d integer; sa integer; sb integer; person integer;
begin
  if action in ('addBreak', 'editBreak', 'delBreak', 'clockOut', 'clockIn') then
    admin := coalesce(ops_private.is_admin(), false);
    pid := ops_private.person_id();
    if action in ('addBreak', 'editBreak', 'delBreak') and not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    if action in ('clockOut', 'clockIn') and pid is null then raise exception 'Only people on the roster can clock out.' using errcode = '42501'; end if;
    select revision into v from public.ops_state where id = 1 for update;
    if expected_revision is null or v <> expected_revision then
      raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
    end if;
    if action in ('addBreak', 'editBreak') then
      k := args->>(case when action = 'addBreak' then 0 else 1 end);
      d := (args->>(case when action = 'addBreak' then 1 else 2 end))::integer;
      sa := (args->>(case when action = 'addBreak' then 2 else 3 end))::integer;
      sb := (args->>(case when action = 'addBreak' then 3 else 4 end))::integer;
      if k is null or k not in ('lunch', 'break') then raise exception 'Choose Lunch or Break.'; end if;
      if sa is null or sb is null or sa < 0 or sb > 1440 or sb <= sa then raise exception 'End time must be after start time.'; end if;
    end if;
    case action
      when 'addBreak' then
        if jsonb_typeof(args->4) <> 'array' or jsonb_array_length(args->4) = 0 then raise exception 'Choose at least one person.'; end if;
        if not exists(select 1 from public.events where id = (args->>5)::integer and d between 0 and days - 1) then raise exception 'Choose a day within the event.'; end if;
        for person in select distinct (x)::text::integer from jsonb_array_elements(args->4) x loop
          if not exists(select 1 from public.people where id = person and not archived) then raise exception 'Choose active people only.'; end if;
          insert into public.breaks(event_id, person_id, kind, day, start_minute, end_minute)
            values((args->>5)::integer, person, k, d, sa, sb) returning * into b;
          insert into public.notifications(person_id, message) values(person, ops_private.break_label(b, 'scheduled'));
        end loop;
      when 'editBreak' then
        select * into b from public.breaks where id = (args->>0)::integer;
        if b.id is null then raise exception 'Break no longer exists.'; end if;
        if not exists(select 1 from public.events where id = b.event_id and d between 0 and days - 1) then raise exception 'Choose a day within the event.'; end if;
        update public.breaks set kind = k, day = d, start_minute = sa, end_minute = sb where id = b.id returning * into b;
        insert into public.notifications(person_id, message) values(b.person_id, ops_private.break_label(b, 'changed'));
      when 'delBreak' then
        select * into b from public.breaks where id = (args->>0)::integer;
        if b.id is null then raise exception 'Break no longer exists.'; end if;
        insert into public.notifications(person_id, message) values(b.person_id, ops_private.break_label(b, 'cancelled'));
        delete from public.breaks where id = b.id;
      when 'clockOut' then
        k := args->>0;
        if k is null or k not in ('lunch', 'break') then raise exception 'Choose Lunch or Break.'; end if;
        if exists(select 1 from public.clocks where person_id = pid and in_at is null) then raise exception 'You are already clocked out. Clock back in first.'; end if;
        target := (select id from public.breaks where id = nullif(args->>1, '')::integer and person_id = pid and kind = k);
        insert into public.clocks(person_id, kind, break_id) values(pid, k, target);
      when 'clockIn' then
        update public.clocks set in_at = now() where person_id = pid and in_at is null;
        if not found then raise exception 'You are not clocked out.'; end if;
    end case;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
    update public.ops_state set revision = revision + 1 where id = 1;
  elsif action = 'addRoom' and jsonb_array_length(args) > 1 then
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
