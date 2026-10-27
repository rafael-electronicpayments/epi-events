-- 2026-10-27 owner request: offsite check-out. Events are at all-inclusive venues, and staff must tell an admin
-- monitor before leaving the property and when they return.
--   * Staff (and Admins on the roster, if they want) tap "I'm Offsite" with a reason (required), and "I'm Onsite"
--     with an optional note. Event Staff, Speakers and Panelists don't get the buttons.
--   * The times are logged, and the person shows as Offsite everywhere until they return.
--   * The event's monitoring admins (chosen in Event setup, at least one per event; for an event set up before this,
--     all admins) get an in-app notice and a push for leaving and for returning. They tap Acknowledge on the
--     leaving notice; who acknowledged, and when, is recorded. The return notice is information only.
--   * Admins get reports: who is offsite now, and every check-out with leave/return times, reasons, acknowledgments.
-- Revision conflicts use PT409 (never 40001; see 20261029120000). Run exactly once.

create table public.event_monitors (
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  primary key (event_id, person_id)
);
create table public.offsite_log (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  left_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 1 and 300),
  back_at timestamptz,
  back_note text not null default '' check (length(back_note) <= 300),
  out_ack_by uuid, out_ack_name text, out_ack_at timestamptz,
  check (back_at is null or back_at >= left_at)
);
create unique index offsite_log_open_idx on public.offsite_log(person_id) where back_at is null;
create index offsite_log_event_idx on public.offsite_log(event_id, left_at);
alter table public.notifications
  add column offsite_id integer references public.offsite_log(id) on delete cascade,
  add column offsite_kind text check (offsite_kind in ('out', 'back'));

alter table public.event_monitors enable row level security;
alter table public.offsite_log enable row level security;
revoke all on public.event_monitors, public.offsite_log from anon, authenticated;

-- Notice (and push) for one check-out or return, to the event's monitors, or every admin when none are set.
create function ops_private.offsite_notify(lid integer, kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.offsite_log; who text; tz text; msg text; ids integer[];
begin
  select * into l from public.offsite_log where id = lid;
  select name into who from public.people where id = l.person_id;
  select coalesce(time_zone, 'America/New_York') into tz from public.events where id = l.event_id;
  if kind = 'out' then
    msg := 'Offsite: ' || who || ' left at ' || to_char(l.left_at at time zone tz, 'FMHH12:MI AM') || '. Reason: ' || l.reason;
  else
    msg := 'Back onsite: ' || who || ' returned at ' || to_char(l.back_at at time zone tz, 'FMHH12:MI AM') || '.'
      || case when l.back_note <> '' then ' Note: ' || l.back_note else '' end;
  end if;
  select coalesce(array_agg(m.person_id), '{}') into ids from public.event_monitors m join public.people p on p.id = m.person_id
    where m.event_id = l.event_id and not p.archived and p.id <> l.person_id;
  if cardinality(ids) = 0 then
    select coalesce(array_agg(p.id), '{}') into ids from public.people p where p.account_type = 'admin' and not p.archived and p.id <> l.person_id;
  end if;
  insert into public.notifications(person_id, message, offsite_id, offsite_kind) select x, msg, lid, kind from unnest(ids) x;
  if to_regclass('public.push_subscriptions') is not null then
    insert into public.push_outbox(person_id, kind, event_id, title, body, url)
      select x, 'notice', l.event_id, case when kind = 'out' then 'Offsite: ' else 'Back onsite: ' end || who, msg, '/'
      from unnest(ids) x where exists(select 1 from public.push_subscriptions s where s.person_id = x);
  end if;
end;
$$;
revoke all on function ops_private.offsite_notify(integer, text) from public, anon, authenticated;

-- Snapshot: "offsiteSupport": true; "away": [{e, ev, since}] people offsite now (everyone sees who is offsite);
-- "offsite": admins get every check-out {id, ev, e, out, why, back, note, oa, oat}, others only their own;
-- "monitors": admins get [{ev, e}]; notes from offsite notices carry "oid" and "ok" ('out' / 'back').
alter function public.ops_snapshot() rename to ops_snapshot_v23;
alter function public.ops_snapshot_v23() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v23() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v23();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object('offsiteSupport', true,
    'away', coalesce((select jsonb_agg(jsonb_build_object('e', l.person_id, 'ev', l.event_id, 'since', l.left_at) order by l.left_at)
      from public.offsite_log l where l.back_at is null and (admin or ops_private.event_open(l.event_id))), '[]'::jsonb),
    'offsite', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ev', l.event_id, 'e', l.person_id, 'out', l.left_at, 'why', l.reason,
        'back', l.back_at, 'note', l.back_note, 'oa', l.out_ack_name, 'oat', l.out_ack_at) order by l.left_at desc, l.id desc)
      from public.offsite_log l where admin or (l.person_id = pid and ops_private.event_open(l.event_id))), '[]'::jsonb),
    'monitors', case when admin then coalesce((select jsonb_agg(jsonb_build_object('ev', m.event_id, 'e', m.person_id) order by m.event_id, m.person_id)
      from public.event_monitors m), '[]'::jsonb) else '[]'::jsonb end,
    'notes', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('oid', n.offsite_id, 'ok', n.offsite_kind)
        from public.notifications n where n.id = (x->>'id')::integer and n.offsite_id is not null), '{}'::jsonb) order by t.n)
      from jsonb_array_elements(snapshot->'notes') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   goOffsite [eventId, reason]   the signed-in person (Staff or Admin on the roster) leaves the property
--   goOnsite  [note]              they're back (note optional)
--   ackOffsite [logId]            an admin acknowledges the leaving notice; it is done for every monitor
--   addEvent / editEvent: the event object may carry "mon": [personId, ...] (Admins in People, at least one)
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v24;
alter function public.ops_command_v24(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v24(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; pid integer; eid integer; lid integer; txt text; l public.offsite_log; o jsonb;
  mon integer[]; result jsonb; target integer; nm text;
begin
  if action in ('addEvent', 'editEvent') then
    o := case when action = 'addEvent' then args->0 else args->1 end;
    if jsonb_typeof(o) = 'object' and jsonb_typeof(o->'mon') = 'array' then
      select coalesce(array_agg(distinct p.id), '{}') into mon from jsonb_array_elements_text(o->'mon') x
        join public.people p on p.id = x::integer and not p.archived and p.account_type = 'admin';
      if cardinality(mon) = 0 then raise exception 'Choose at least one admin to monitor staff going offsite.'; end if;
      args := case when action = 'addEvent' then jsonb_build_array(o - 'mon') || (args - 0) else jsonb_set(args, '{1}', o - 'mon') end;
    end if;
    result := ops_private.ops_command_v24(action, args, expected_revision);
    if mon is not null then
      -- Writes are serialized by the ops_state row lock, so the newest event is the one just created.
      target := case when action = 'addEvent' then (select max(id) from public.events) else (args->>0)::integer end;
      if exists(select 1 from public.event_monitors where event_id = target and not (person_id = any(mon)))
        or exists(select 1 from unnest(mon) x where not exists(select 1 from public.event_monitors where event_id = target and person_id = x)) then
        delete from public.event_monitors where event_id = target;
        insert into public.event_monitors(event_id, person_id) select target, x from unnest(mon) x;
        result := public.ops_snapshot();
      end if;
    end if;
    return result;
  end if;
  if action not in ('goOffsite', 'goOnsite', 'ackOffsite') then return ops_private.ops_command_v24(action, args, expected_revision); end if;

  admin := coalesce(ops_private.is_admin(), false);
  pid := ops_private.person_id();
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = 'PT409';
  end if;

  if action = 'goOffsite' then
    if pid is null or not exists(select 1 from public.people where id = pid and not archived and account_type in ('staff', 'admin')) then
      raise exception 'Offsite check-out is for Staff and Admins on the roster.' using errcode = '42501';
    end if;
    eid := (args->>0)::integer;
    if not exists(select 1 from public.events where id = eid) or not ops_private.event_open(eid) then raise exception 'Choose an open event.'; end if;
    txt := btrim(coalesce(args->>1, ''));
    if txt = '' then raise exception 'Enter the reason you''re leaving the property.'; end if;
    if length(txt) > 300 then raise exception 'Keep the reason to 300 characters.'; end if;
    if exists(select 1 from public.offsite_log where person_id = pid and back_at is null) then raise exception 'You''re already checked out as offsite.'; end if;
    insert into public.offsite_log(event_id, person_id, reason) values(eid, pid, txt) returning id into lid;
    perform ops_private.offsite_notify(lid, 'out');
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('person_id', pid, 'event_id', eid, 'reason', txt));

  elsif action = 'goOnsite' then
    if pid is null then raise exception 'Offsite check-out is for people on the roster.' using errcode = '42501'; end if;
    txt := btrim(coalesce(args->>0, ''));
    if length(txt) > 300 then raise exception 'Keep the note to 300 characters.'; end if;
    update public.offsite_log set back_at = now(), back_note = txt where person_id = pid and back_at is null returning id into lid;
    if lid is null then raise exception 'You''re not checked out as offsite.'; end if;
    perform ops_private.offsite_notify(lid, 'back');
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('person_id', pid, 'log_id', lid));

  else
    if not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    lid := (args->>0)::integer;
    select * into l from public.offsite_log where id = lid;
    if l.id is null then raise exception 'This offsite record no longer exists.'; end if;
    nm := coalesce((select name from public.people where id = pid), (select email from auth.users where id = auth.uid()), 'An administrator');
    if l.out_ack_at is null then
      update public.offsite_log set out_ack_by = auth.uid(), out_ack_name = nm, out_ack_at = now() where id = lid;
    end if;
    update public.notifications set done = true where offsite_id = lid and offsite_kind = 'out' and not done;
  end if;
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
