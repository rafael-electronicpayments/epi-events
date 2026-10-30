-- 2026-10-30 owner requests:
--   * Offsite contact: in Event setup, one of the event's offsite monitors is ticked as the contact. The staff
--     "Leaving the property?" card then says "Check out with <name> (<phone>) before you go, and check back in when
--     you return." The contact's name and phone (from People) are shown to everyone in the event.
--   * Staff locator (Planning › Staff locator): where everyone is assigned, now and today, without activity details.
--     Admins always see it; admins choose per event which other people can see it.
--   * My schedule: "Acknowledge all" and "Got it all" act on every open notice of that kind with one tap.
-- Revision conflicts use PT409 (never 40001; see 20261029120000). Run exactly once (it renames functions).

alter table public.event_monitors add column is_contact boolean not null default false;
create unique index event_monitors_contact_idx on public.event_monitors(event_id) where is_contact;

create table public.locator_viewers (
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  primary key (event_id, person_id)
);
create index locator_viewers_person_idx on public.locator_viewers(person_id);
alter table public.locator_viewers enable row level security;
revoke all on public.locator_viewers from anon, authenticated;

-- Snapshot:
--   "monitors" (admins): [{ev, e, c}] where c marks the contact.
--   "offsiteContact": [{ev, e, n, ph}] the contact per event (admins: every event; others: open events).
--   "locatorSupport": true; "locViewers": admins [{ev, e}] for every event, others their own rows.
--   "locator" (non-admin viewers only; admins use the schedule they already have): every assignment in the events
--     they can see, with only who, their title, the activity name, room, day and times:
--     [{id, ev, e, n, tm, t, r, d, a, b}].
alter function public.ops_snapshot() rename to ops_snapshot_v25;
alter function public.ops_snapshot_v25() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v25() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v25();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object(
    'monitors', case when admin then coalesce((select jsonb_agg(jsonb_build_object('ev', m.event_id, 'e', m.person_id, 'c', m.is_contact) order by m.event_id, m.person_id)
      from public.event_monitors m), '[]'::jsonb) else '[]'::jsonb end,
    'offsiteContact', coalesce((select jsonb_agg(jsonb_build_object('ev', m.event_id, 'e', m.person_id, 'n', p.name, 'ph', p.phone) order by m.event_id)
      from public.event_monitors m join public.people p on p.id = m.person_id
      where m.is_contact and not p.archived and (admin or ops_private.event_open(m.event_id))), '[]'::jsonb),
    'locatorSupport', true,
    'locViewers', coalesce((select jsonb_agg(jsonb_build_object('ev', v.event_id, 'e', v.person_id) order by v.event_id, v.person_id)
      from public.locator_viewers v where admin or (pid is not null and v.person_id = pid and ops_private.event_open(v.event_id))), '[]'::jsonb),
    'locator', case when admin or pid is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'ev', ac.event_id, 'e', a.person_id,
        'n', p.name, 'tm', p.title, 't', ac.title, 'r', r.name, 'd', ac.day, 'a', ac.start_minute, 'b', ac.end_minute) order by ac.event_id, ac.day, ac.start_minute, p.name)
      from public.assignments a join public.activities ac on ac.id = a.activity_id join public.people p on p.id = a.person_id
        left join public.rooms r on r.id = ac.room_id
      where not p.archived and ops_private.event_open(ac.event_id)
        and exists(select 1 from public.locator_viewers v where v.event_id = ac.event_id and v.person_id = pid)), '[]'::jsonb) end);
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   addEvent / editEvent: the event object may carry "monc": personId (one of "mon") as the offsite contact, or null.
--   setLocatorViewers [eventId, [personId, ...]]   admins: non-admin people who can see the staff locator
--   ackAll   [{"a": [assignmentId...], "r": [reminderId...], "o": [offsiteLogId...]}]   the signed-in person's notices
--   dismissAll [[notificationId, ...]]                                                  "Got it" on each
--   Each item runs through the existing single command; an item that no longer applies is skipped.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v26;
alter function public.ops_command_v26(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v26(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; o jsonb; has_c boolean := false; c integer; target integer; result jsonb; eid integer; evname text;
  before integer[]; after integer[]; x integer; k text; act text; n integer := 0;
begin
  if action in ('addEvent', 'editEvent') then
    o := case when action = 'addEvent' then args->0 else args->1 end;
    if jsonb_typeof(o) = 'object' and o ? 'monc' then
      has_c := true;
      c := case when jsonb_typeof(o->'monc') = 'number' then (o->>'monc')::integer end;
      args := case when action = 'addEvent' then jsonb_build_array(o - 'monc') || (args - 0) else jsonb_set(args, '{1}', o - 'monc') end;
    end if;
    result := ops_private.ops_command_v26(action, args, expected_revision);
    if has_c then
      -- Writes are serialized by the ops_state row lock, so the newest event is the one just created.
      target := case when action = 'addEvent' then (select max(id) from public.events) else (args->>0)::integer end;
      if exists(select 1 from public.event_monitors where event_id = target and is_contact is distinct from (person_id = c)) then
        update public.event_monitors set is_contact = false where event_id = target and is_contact and person_id is distinct from c;
        update public.event_monitors set is_contact = true where event_id = target and person_id = c and not is_contact;
        result := public.ops_snapshot();
      end if;
    end if;
    return result;
  end if;
  if action not in ('setLocatorViewers', 'ackAll', 'dismissAll') then
    return ops_private.ops_command_v26(action, args, expected_revision);
  end if;

  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = 'PT409';
  end if;

  if action = 'setLocatorViewers' then
    if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    eid := (args->>0)::integer;
    select name into evname from public.events where id = eid;
    if evname is null then raise exception 'Choose an event.'; end if;
    if jsonb_typeof(args->1) <> 'array' or jsonb_array_length(args->1) > 500 then raise exception 'Choose up to 500 people.'; end if;
    select coalesce(array_agg(person_id), '{}') into before from public.locator_viewers where event_id = eid;
    select coalesce(array_agg(distinct p.id), '{}') into after from jsonb_array_elements_text(args->1) t(val)
      join public.people p on p.id = t.val::integer and not p.archived and p.account_type <> 'admin';
    delete from public.locator_viewers where event_id = eid and not (person_id = any(after));
    insert into public.locator_viewers(event_id, person_id) select eid, y from unnest(after) y on conflict do nothing;
    insert into public.notifications(person_id, message)
      select y, 'You can now see where staff are assigned for ' || evname || ' (Staff locator).' from unnest(after) y where not (y = any(before));
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('event_id', eid, 'people', cardinality(after)));
  else
    if ops_private.person_id() is null and not coalesce(ops_private.is_admin(), false) then raise exception 'Sign in first.' using errcode = '42501'; end if;
    for k, act in select * from (values ('a', 'ack'), ('r', 'ackReminder'), ('o', 'ackOffsite'), ('n', 'dismiss')) t(k, act) loop
      continue when (action = 'ackAll') = (k = 'n');
      o := case when action = 'dismissAll' then args->0 else args->0->k end;
      continue when jsonb_typeof(o) is distinct from 'array';
      if jsonb_array_length(o) > 300 then raise exception 'Too many notices at once.'; end if;
      for x in select distinct (val)::integer from jsonb_array_elements_text(o) t(val) loop
        begin
          perform ops_private.ops_command_v26(act, jsonb_build_array(x), (select revision from public.ops_state where id = 1));
          n := n + 1;
        exception when others then null;  -- already done, removed, or not this person's: skip it
        end;
      end loop;
    end loop;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('done', n));
  end if;
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
