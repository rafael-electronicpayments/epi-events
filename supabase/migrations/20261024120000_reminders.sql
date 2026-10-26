-- 2026-10-23 owner request: quick reminders from admins (Manage › Messages).
--   An admin sends a short message (up to 200 characters) to chosen people working the current event, or to everyone
--   working it. Each person gets an in-app notice and, if they turned notifications on, a push (same delivery as
--   assignments). They tap Acknowledge to show they got it; admins see who has and hasn't, and can remind again.
-- Run exactly once (it renames functions).

create table public.reminders (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 200),
  sent_by uuid,
  sender_name text not null default '' check (length(sender_name) <= 120),
  created_at timestamptz not null default now()
);
create table public.reminder_recipients (
  reminder_id integer not null references public.reminders(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  acked_at timestamptz,
  primary key (reminder_id, person_id)
);
create index reminder_recipients_person_idx on public.reminder_recipients(person_id);
alter table public.notifications add column reminder_id integer references public.reminders(id) on delete cascade;

-- Everything goes through ops_snapshot / ops_command.
alter table public.reminders enable row level security;
alter table public.reminder_recipients enable row level security;
revoke all on public.reminders, public.reminder_recipients from anon, authenticated;

-- Push kind for reminders.
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.push_outbox'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table public.push_outbox drop constraint %I', c); end if;
  alter table public.push_outbox add constraint push_outbox_kind_check check (kind in ('assignment', 'reminder', 'test', 'travel', 'pickup', 'notice'));
end;
$$;

-- Sender: a reminder push that couldn't be delivered within 2 hours is no longer useful.
alter function public.push_claim(integer) rename to push_claim_v2;
alter function public.push_claim_v2(integer) set schema ops_private;
revoke all on function ops_private.push_claim_v2(integer) from public, anon, authenticated;
create function public.push_claim(max_rows integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claimed jsonb;
begin
  update public.push_outbox set status = 'skipped', last_error = 'Too late: the reminder is over 2 hours old'
    where kind = 'notice' and status in ('pending', 'sending') and created_at < now() - interval '2 hours';
  claimed := ops_private.push_claim_v2(max_rows);
  return coalesce((select jsonb_agg(case when c->>'kind' = 'notice' then jsonb_set(c, '{ttl}', '7200') else c end order by n)
    from jsonb_array_elements(claimed) with ordinality t(c, n)), '[]'::jsonb);
end;
$$;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
do $$
begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.push_claim(integer) to service_role';
  end if;
end;
$$;

-- Snapshot: "reminders": admins get every reminder with its recipients ({e, ack}); others get only the ones sent to
-- them ({id, ev, x, from, at, ack}). Notes from a reminder carry "rid" and "from".
alter function public.ops_snapshot() rename to ops_snapshot_v16;
alter function public.ops_snapshot_v16() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v16() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v16();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object(
    'reminders', case when admin then
      coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ev', r.event_id, 'x', r.body, 'from', r.sender_name, 'at', r.created_at,
          'to', coalesce((select jsonb_agg(jsonb_build_object('e', rr.person_id, 'ack', rr.acked_at) order by rr.person_id)
            from public.reminder_recipients rr where rr.reminder_id = r.id), '[]'::jsonb)) order by r.id desc)
        from public.reminders r), '[]'::jsonb)
    else
      coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ev', r.event_id, 'x', r.body, 'from', r.sender_name, 'at', r.created_at, 'ack', rr.acked_at) order by r.id desc)
        from public.reminders r join public.reminder_recipients rr on rr.reminder_id = r.id and rr.person_id = pid
        where ops_private.event_open(r.event_id)), '[]'::jsonb)
    end,
    'notes', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('rid', n.reminder_id, 'from', r.sender_name)
        from public.notifications n join public.reminders r on r.id = n.reminder_id where n.id = (x->>'id')::integer), '{}'::jsonb) order by t.n)
      from jsonb_array_elements(snapshot->'notes') with ordinality t(x, n)
      where admin or not exists(select 1 from public.notifications n join public.reminders r on r.id = n.reminder_id
        where n.id = (x->>'id')::integer and not ops_private.event_open(r.event_id))), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   sendReminder [eventId, [personId, ...], text]   admins; up to 500 people, 200 characters
--   ackReminder  [reminderId]                       the recipient: marks it received (and the notice done)
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v16;
alter function public.ops_command_v16(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v16(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; admin boolean; pid integer; eid integer; ev public.events; body text; sender text; rid integer;
  ids integer[]; n integer;
begin
  if action not in ('sendReminder', 'ackReminder') then return ops_private.ops_command_v16(action, args, expected_revision); end if;
  admin := coalesce(ops_private.is_admin(), false);
  pid := ops_private.person_id();
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;

  if action = 'sendReminder' then
    if not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    eid := (args->>0)::integer;
    select * into ev from public.events where id = eid;
    if ev.id is null then raise exception 'Choose an event.'; end if;
    if ev.closed then raise exception 'This event is closed. Reopen it to send reminders.'; end if;
    body := btrim(coalesce(args->>2, ''));
    if body = '' then raise exception 'Write the message.'; end if;
    if length(body) > 200 then raise exception 'Keep the message to 200 characters.'; end if;
    if jsonb_typeof(args->1) <> 'array' then raise exception 'Choose who to send it to.'; end if;
    select coalesce(array_agg(distinct p.id), '{}') into ids
      from jsonb_array_elements_text(args->1) x join public.people p on p.id = x::integer and not p.archived;
    if cardinality(ids) = 0 then raise exception 'Choose who to send it to.'; end if;
    if cardinality(ids) > 500 then raise exception 'Send to 500 people at most.'; end if;
    sender := coalesce((select name from public.people where id = pid), 'An administrator');
    insert into public.reminders(event_id, body, sent_by, sender_name) values(eid, body, auth.uid(), sender) returning id into rid;
    insert into public.reminder_recipients(reminder_id, person_id) select rid, unnest(ids);
    insert into public.notifications(person_id, message, reminder_id) select unnest(ids), body, rid;
    if to_regclass('public.push_subscriptions') is not null then
      insert into public.push_outbox(person_id, kind, event_id, title, body, url)
        select x, 'notice', eid, 'Message from ' || sender, body, '/'
        from unnest(ids) x where exists(select 1 from public.push_subscriptions s where s.person_id = x);
    end if;
    insert into public.activity_log(actor_id, action, details)
      values(auth.uid(), action, jsonb_build_object('event_id', eid, 'reminder_id', rid, 'people', cardinality(ids), 'text', body));
  else
    rid := (args->>0)::integer;
    if pid is null or not exists(select 1 from public.reminder_recipients where reminder_id = rid and person_id = pid) then
      raise exception 'This message wasn''t sent to you.' using errcode = '42501';
    end if;
    if not exists(select 1 from public.reminders r where r.id = rid and ops_private.event_open(r.event_id)) then
      raise exception 'This event is closed.' using errcode = '42501';
    end if;
    update public.reminder_recipients set acked_at = now() where reminder_id = rid and person_id = pid and acked_at is null;
    get diagnostics n = row_count;
    update public.notifications set done = true where reminder_id = rid and person_id = pid;
    if n = 0 then return public.ops_snapshot(); end if;
  end if;
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
