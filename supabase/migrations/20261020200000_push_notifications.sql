-- 2026-10-20 owner request: push notifications (installable web app + Web Push). See docs/PUSH_NOTIFICATIONS.md.
-- People register each device they turn notifications on for. Assignment changes queue an immediate push and a
-- reminder 30 minutes before the start, in the event's time zone. A Vercel function sends the queue once a
-- minute (called by pg_cron through pg_net) and reports the results back here.
-- This only adds tables, triggers, and functions, so code without push support keeps working on this database.

alter table public.events add column time_zone text not null default 'America/New_York';

-- One row per device (browser) a person turned notifications on for.
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  person_id integer not null references public.people(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  device text not null default '' check (length(device) <= 200),
  created_at timestamptz not null default now(),
  last_success timestamptz,
  last_failure timestamptz,
  failures integer not null default 0,
  last_error text
);
create index push_subscriptions_person_idx on public.push_subscriptions(person_id);

-- Messages waiting to be sent. assignment_id has no foreign key on purpose: a removal notice outlives its assignment.
create table public.push_outbox (
  id bigint generated always as identity primary key,
  person_id integer not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'reminder', 'test')),
  assignment_id integer,
  assignment_seq integer,
  event_id integer,
  title text not null,
  body text not null,
  url text not null default '/',
  due_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_outbox_due_idx on public.push_outbox(next_attempt) where status in ('pending', 'sending');
create index push_outbox_assignment_idx on public.push_outbox(assignment_id) where assignment_id is not null;
create index push_outbox_person_idx on public.push_outbox(person_id);

-- One row per delivery attempt to one device.
create table public.push_log (
  id bigint generated always as identity primary key,
  outbox_id bigint references public.push_outbox(id) on delete set null,
  person_id integer references public.people(id) on delete cascade,
  kind text not null,
  ok boolean not null,
  status_code integer,
  error text,
  device text,
  created_at timestamptz not null default now()
);
create index push_log_person_idx on public.push_log(person_id);

-- No direct table access for anyone; everything goes through the functions below.
alter table public.push_subscriptions enable row level security;
alter table public.push_outbox enable row level security;
alter table public.push_log enable row level security;
revoke all on public.push_subscriptions, public.push_outbox, public.push_log from anon, authenticated;

-- Only real browser push services are accepted, so the sender never posts to arbitrary addresses.
create function ops_private.push_endpoint_ok(endpoint text) returns boolean language sql immutable set search_path = '' as $$
  select endpoint is not null and length(endpoint) <= 1000 and endpoint ~ ('^https://(fcm\.googleapis\.com|android\.googleapis\.com'
    || '|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com'
    || '|[a-z0-9.-]+\.notify\.windows\.com)/');
$$;
create function ops_private.push_check_zone(tz text) returns void language plpgsql stable set search_path = '' as $$
begin
  if tz is null or tz !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$' then raise exception 'Choose a valid time zone.'; end if;
  perform now() at time zone tz;
exception when invalid_parameter_value then raise exception 'Choose a valid time zone.';
end;
$$;
-- Activity start/end as real moments, using the event's time zone.
create function ops_private.push_at(e public.events, d integer, m integer) returns timestamptz
language sql stable set search_path = '' as $$
  select ((e.start_date + d) + make_interval(mins => m)) at time zone e.time_zone;
$$;
-- e.g. "Opening keynote · Grand Ballroom · Sat, Nov 7, 9:00 AM"
create function ops_private.push_body(e public.events, s public.activities) returns text
language sql stable security definer set search_path = '' as $$
  select s.title || ' · ' || coalesce((select r.name from public.rooms r where r.id = s.room_id), '') || ' · '
    || to_char(e.start_date + s.day, 'FMDy, Mon FMDD') || ', ' || to_char(time '00:00' + make_interval(mins => s.start_minute), 'FMHH12:MI AM');
$$;

-- Queue pushes for one assignment: optionally an immediate one, and (always) a fresh 30-minute reminder.
-- Old pending reminders for the assignment are dropped first. Nothing is queued for closed events,
-- archived people, or activities that have already ended. Under 30 minutes before start: no reminder.
create function ops_private.push_queue(aid integer, label text, immediate boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; s public.activities; e public.events; starts timestamptz; body text;
begin
  delete from public.push_outbox where assignment_id = aid and kind = 'reminder' and status = 'pending';
  select * into a from public.assignments where id = aid;
  if a.id is null then return; end if;
  select * into s from public.activities where id = a.activity_id;
  select * into e from public.events where id = s.event_id;
  if e.id is null or e.closed then return; end if;
  if not exists(select 1 from public.people where id = a.person_id and not archived) then return; end if;
  if ops_private.push_at(e, s.day, s.end_minute) <= now() then return; end if;
  starts := ops_private.push_at(e, s.day, s.start_minute);
  body := ops_private.push_body(e, s);
  if immediate then
    insert into public.push_outbox(person_id, kind, assignment_id, assignment_seq, event_id, title, body, url)
      values(a.person_id, 'assignment', a.id, a.sequence, e.id, label, body, '/?asg=' || a.id);
  end if;
  if starts - interval '30 minutes' > now() then
    insert into public.push_outbox(person_id, kind, assignment_id, assignment_seq, event_id, title, body, url, due_at, next_attempt)
      values(a.person_id, 'reminder', a.id, a.sequence, e.id, 'Starts in 30 minutes', body, '/?asg=' || a.id,
        starts - interval '30 minutes', starts - interval '30 minutes');
  end if;
end;
$$;
-- Recompute reminders (no immediate push) for every assignment in an event, e.g. after a time zone change or reopening.
create function ops_private.push_requeue_event(eid integer) returns void
language plpgsql security definer set search_path = '' as $$
declare rec record;
begin
  for rec in select a.id from public.assignments a join public.activities s on s.id = a.activity_id where s.event_id = eid loop
    perform ops_private.push_queue(rec.id, null, false);
  end loop;
end;
$$;

-- New, changed, and removed assignments. "Changed" means its version (sequence), activity, or person changed,
-- which is exactly when people are asked to acknowledge again.
create function ops_private.push_on_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.activities; e public.events;
begin
  if tg_op = 'INSERT' then
    perform ops_private.push_queue(new.id, 'New assignment', true);
  elsif tg_op = 'UPDATE' then
    if new.sequence is distinct from old.sequence or new.activity_id <> old.activity_id or new.person_id <> old.person_id then
      perform ops_private.push_queue(new.id, 'Assignment changed', true);
    end if;
  else
    delete from public.push_outbox where assignment_id = old.id and kind = 'reminder' and status = 'pending';
    -- When the activity itself is being deleted it is already gone here; its own trigger sent the cancellation.
    select * into s from public.activities where id = old.activity_id;
    if s.id is null then return null; end if;
    select * into e from public.events where id = s.event_id;
    if e.id is null or e.closed or ops_private.push_at(e, s.day, s.end_minute) <= now()
      or not exists(select 1 from public.people where id = old.person_id and not archived) then return null; end if;
    insert into public.push_outbox(person_id, kind, assignment_id, event_id, title, body)
      values(old.person_id, 'assignment', old.id, e.id, 'Removed from assignment', ops_private.push_body(e, s));
  end if;
  return null;
end;
$$;
create trigger assignments_push after insert or update or delete on public.assignments
  for each row execute function ops_private.push_on_assignment();

create function ops_private.push_on_activity_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = old.event_id;
  if e.id is null or e.closed or ops_private.push_at(e, old.day, old.end_minute) <= now() then return old; end if;
  insert into public.push_outbox(person_id, kind, assignment_id, event_id, title, body)
    select a.person_id, 'assignment', a.id, e.id, 'Activity cancelled', ops_private.push_body(e, old)
    from public.assignments a join public.people p on p.id = a.person_id and not p.archived where a.activity_id = old.id;
  return old;
end;
$$;
create trigger activities_push before delete on public.activities
  for each row execute function ops_private.push_on_activity_delete();

create function ops_private.push_on_event_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.closed or ops_private.push_at(old, old.days, 0) <= now() then return old; end if;
  insert into public.push_outbox(person_id, kind, title, body)
    select distinct a.person_id, 'assignment', 'Event removed', old.name
    from public.activities s join public.assignments a on a.activity_id = s.id
    join public.people p on p.id = a.person_id and not p.archived where s.event_id = old.id;
  return old;
end;
$$;
create trigger events_push before delete on public.events
  for each row execute function ops_private.push_on_event_delete();

revoke all on function ops_private.push_endpoint_ok(text), ops_private.push_check_zone(text),
  ops_private.push_at(public.events, integer, integer), ops_private.push_body(public.events, public.activities),
  ops_private.push_queue(integer, text, boolean), ops_private.push_requeue_event(integer),
  ops_private.push_on_assignment(), ops_private.push_on_activity_delete(), ops_private.push_on_event_delete()
  from public, anon, authenticated;

-- Devices: people register and remove only their own.
create function public.push_register(subscription jsonb, device text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid integer := ops_private.person_id(); ep text := subscription->>'endpoint';
  k1 text := subscription->'keys'->>'p256dh'; k2 text := subscription->'keys'->>'auth';
begin
  if auth.uid() is null or pid is null then raise exception 'Only people on the roster can turn on notifications.' using errcode = '42501'; end if;
  if not ops_private.push_endpoint_ok(ep) then raise exception 'This browser''s notification service is not supported.'; end if;
  if coalesce(k1, '') !~ '^[A-Za-z0-9_-]{20,200}={0,2}$' or coalesce(k2, '') !~ '^[A-Za-z0-9_-]{8,100}={0,2}$' then
    raise exception 'This browser sent invalid notification keys.';
  end if;
  insert into public.push_subscriptions(person_id, endpoint, p256dh, auth, device)
    values(pid, ep, k1, k2, left(coalesce(device, ''), 200))
    on conflict (endpoint) do update set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth,
      device = excluded.device, failures = 0, last_error = null;
  return jsonb_build_object('devices', (select count(*) from public.push_subscriptions where person_id = pid));
end;
$$;
create function public.push_unregister(endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid integer := ops_private.person_id();
begin
  if auth.uid() is null or pid is null then raise exception 'Only people on the roster can turn off notifications.' using errcode = '42501'; end if;
  delete from public.push_subscriptions s where s.endpoint = push_unregister.endpoint and s.person_id = pid;
  return jsonb_build_object('devices', (select count(*) from public.push_subscriptions where person_id = pid));
end;
$$;
revoke all on function public.push_register(jsonb, text), public.push_unregister(text) from public, anon;
grant execute on function public.push_register(jsonb, text), public.push_unregister(text) to authenticated;

-- Sender protocol (service role only). push_claim hands out due messages with the person's devices and
-- re-checks that they are still wanted; push_report records each device's result and schedules retries.
create function public.push_claim(max_rows integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.push_outbox; claimed jsonb := '[]'::jsonb; devs jsonb; why text;
  a public.assignments; s public.activities; e public.events;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '14 days';
  delete from public.push_log where created_at < now() - interval '14 days';
  for r in select * from public.push_outbox where status in ('pending', 'sending') and next_attempt <= now() and due_at <= now()
      order by next_attempt, id limit greatest(1, least(coalesce(max_rows, 50), 200)) for update skip locked loop
    why := null;
    if r.status = 'sending' and r.attempts >= 4 then why := 'No result from the sender';
    elsif not exists(select 1 from public.people where id = r.person_id and not archived) then why := 'Person archived';
    elsif r.event_id is not null and not exists(select 1 from public.events where id = r.event_id and not closed) then why := 'Event closed or removed';
    elsif r.kind = 'reminder' then
      select * into a from public.assignments where id = r.assignment_id;
      if a.id is null or a.sequence is distinct from r.assignment_seq or a.person_id <> r.person_id then
        why := 'Assignment changed or removed';
      else
        select * into s from public.activities where id = a.activity_id;
        select * into e from public.events where id = s.event_id;
        if ops_private.push_at(e, s.day, s.start_minute) <= now() then why := 'Too late: the activity has started'; end if;
      end if;
    end if;
    if why is null then
      select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth) order by d.id), '[]'::jsonb)
        into devs from public.push_subscriptions d where d.person_id = r.person_id;
      if jsonb_array_length(devs) = 0 then why := 'No devices'; end if;
    end if;
    if why is not null then
      update public.push_outbox set status = case when why = 'No result from the sender' then 'failed' else 'skipped' end, last_error = why where id = r.id;
    else
      update public.push_outbox set status = 'sending', attempts = attempts + 1, next_attempt = now() + interval '2 minutes' where id = r.id;
      claimed := claimed || jsonb_build_array(jsonb_build_object('id', r.id, 'kind', r.kind,
        'ttl', case when r.kind = 'reminder' then 1800 else 43200 end,
        'payload', jsonb_build_object('title', r.title, 'body', r.body, 'url', r.url,
          'tag', case when r.assignment_id is not null then 'asg-' || r.assignment_id else 'ops-' || r.id end),
        'devices', devs));
    end if;
  end loop;
  return claimed;
end;
$$;
create function public.push_report(results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x jsonb; d jsonb; r public.push_outbox; delivered boolean; err text; alive integer; done integer := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(results, '[]'::jsonb)) loop
    select * into r from public.push_outbox where id = (x->>'id')::bigint and status = 'sending' for update;
    if r.id is null then continue; end if;
    delivered := false; err := null;
    for d in select * from jsonb_array_elements(coalesce(x->'devices', '[]'::jsonb)) loop
      insert into public.push_log(outbox_id, person_id, kind, ok, status_code, error, device)
        values(r.id, r.person_id, r.kind, coalesce((d->>'ok')::boolean, false), nullif(d->>'status', '')::integer,
          left(d->>'error', 300), (select device from public.push_subscriptions where id = (d->>'id')::bigint));
      if coalesce((d->>'ok')::boolean, false) then
        delivered := true;
        update public.push_subscriptions set last_success = now(), failures = 0, last_error = null where id = (d->>'id')::bigint;
      elsif coalesce((d->>'gone')::boolean, false) then
        -- The push service says this device no longer exists (app removed or permission revoked).
        delete from public.push_subscriptions where id = (d->>'id')::bigint;
        err := coalesce(err, 'Device no longer registered');
      else
        update public.push_subscriptions set last_failure = now(), failures = failures + 1, last_error = left(d->>'error', 300)
          where id = (d->>'id')::bigint;
        err := coalesce(err, left(d->>'error', 300), 'Delivery failed');
      end if;
    end loop;
    select count(*) into alive from public.push_subscriptions where person_id = r.person_id;
    if delivered then
      update public.push_outbox set status = 'sent', sent_at = now(), last_error = null where id = r.id;
    elsif alive = 0 then
      update public.push_outbox set status = 'skipped', last_error = coalesce(err, 'No devices') where id = r.id;
    elsif r.attempts >= 4 then
      update public.push_outbox set status = 'failed', last_error = err where id = r.id;
    else
      -- Retry after 1, 5, then 15 minutes.
      update public.push_outbox set status = 'pending', last_error = err,
        next_attempt = now() + case r.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '15 minutes' end
        where id = r.id;
    end if;
    done := done + 1;
  end loop;
  return jsonb_build_object('recorded', done);
end;
$$;
revoke all on function public.push_claim(integer), public.push_report(jsonb) from public, anon, authenticated;

-- Snapshot: everything from before, plus each event's time zone, this person's device count, and for admins
-- per-person enrollment, the latest test result, and recent failed deliveries.
alter function public.ops_snapshot() rename to ops_snapshot_v4;
alter function public.ops_snapshot_v4() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v4() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v4();
  pid := (snapshot->>'me')::integer;
  snapshot := snapshot || jsonb_build_object(
    'events', coalesce((select jsonb_agg(x || jsonb_build_object('tz', coalesce((select e.time_zone from public.events e
        where e.id = (x->>'id')::integer), 'America/New_York')) order by n) from jsonb_array_elements(snapshot->'events') with ordinality t(x, n)), '[]'::jsonb),
    'push', jsonb_build_object('devices', (select count(*) from public.push_subscriptions where person_id = pid)));
  if snapshot->>'role' <> 'admin' then return snapshot; end if;
  return snapshot || jsonb_build_object(
    'pushStatus', coalesce((select jsonb_agg(jsonb_build_object('e', g.id, 'n', g.n, 'ok', g.ok, 'bad', g.bad, 'devices', g.devices) order by g.id)
      from (select p.id, count(d.id) n, max(d.last_success) ok, max(d.last_failure) bad,
          coalesce(jsonb_agg(d.device order by d.id) filter (where d.id is not null), '[]'::jsonb) devices
        from public.people p left join public.push_subscriptions d on d.person_id = p.id where not p.archived group by p.id) g), '[]'::jsonb),
    'pushTests', coalesce((select jsonb_agg(jsonb_build_object('e', t.person_id, 'st', t.status, 'at', coalesce(t.sent_at, t.created_at), 'err', t.last_error))
      from (select distinct on (o.person_id) o.* from public.push_outbox o where o.kind = 'test' order by o.person_id, o.id desc) t), '[]'::jsonb),
    'pushLog', coalesce((select jsonb_agg(jsonb_build_object('t', l.created_at, 'e', l.person_id, 'k', l.kind, 'err', l.error,
        'code', l.status_code, 'dev', l.device) order by l.id desc)
      from (select * from public.push_log where not ok order by id desc limit 30) l), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: admins send test notifications; events take an optional time zone ("tz") on add/edit;
-- reopening an event or changing its time zone recomputes reminders. Everything else is unchanged.
--   pushTest [personId]   addEvent [{..., tz}]   editEvent [id, {..., tz}]
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v5;
alter function public.ops_command_v5(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v5(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; tz text; target integer; pname text; result jsonb;
begin
  if action = 'pushTest' then
    if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    select revision into v from public.ops_state where id = 1 for update;
    if expected_revision is null or v <> expected_revision then
      raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
    end if;
    target := (args->>0)::integer;
    select name into pname from public.people where id = target and not archived;
    if pname is null then raise exception 'Choose an active person.'; end if;
    if not exists(select 1 from public.push_subscriptions where person_id = target) then
      raise exception '% hasn''t turned on notifications on any device yet.', pname;
    end if;
    insert into public.push_outbox(person_id, kind, title, body)
      values(target, 'test', 'Test notification', 'Notifications from Impact Event Ops are working on this device.');
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('person_id', target, 'name', pname));
    update public.ops_state set revision = revision + 1 where id = 1;
    return public.ops_snapshot();
  end if;
  if action in ('addEvent', 'editEvent') then
    tz := nullif(btrim((case when action = 'addEvent' then args->0 else args->1 end)->>'tz'), '');
    if tz is not null then perform ops_private.push_check_zone(tz); end if;
  end if;
  result := ops_private.ops_command_v5(action, args, expected_revision);
  if tz is not null then
    -- Writes are serialized by the ops_state row lock, so the newest event is the one just created.
    target := case when action = 'addEvent' then (select max(id) from public.events) else (args->>0)::integer end;
    update public.events set time_zone = tz where id = target and time_zone <> tz;
    if found then
      perform ops_private.push_requeue_event(target);
      result := public.ops_snapshot();
    end if;
  elsif action = 'setEventClosed' and not coalesce((args->>1)::boolean, false) then
    perform ops_private.push_requeue_event((args->>0)::integer);
  end if;
  return result;
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;

-- Once a minute: if anything is due, ask the sender to run. Its address and shared secret live in Supabase Vault
-- ('push_dispatch_url', 'push_dispatch_secret'), set separately and never committed. Without them this does nothing.
create function ops_private.push_kick() returns void language plpgsql security definer set search_path = '' as $$
declare target text; secret text;
begin
  if not exists(select 1 from public.push_outbox where status in ('pending', 'sending') and next_attempt <= now() and due_at <= now()) then return; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into target using 'push_dispatch_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into secret using 'push_dispatch_secret';
  if target is null or secret is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using target, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-push-dispatch-secret', secret);
end;
$$;
revoke all on function ops_private.push_kick() from public, anon, authenticated;

-- Supabase only (skipped where these are unavailable, e.g. local PGlite tests).
do $$
begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.push_claim(integer), public.push_report(jsonb) to service_role';
  end if;
  if exists(select 1 from pg_available_extensions where name = 'pg_cron')
    and exists(select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net with schema extensions';
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute $c$select cron.schedule('push-dispatch', '* * * * *', 'select ops_private.push_kick()')$c$;
  end if;
end;
$$;
