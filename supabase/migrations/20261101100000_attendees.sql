-- 2026-10-30 owner request: Attendees (its own menu group).
--   Admins import the event's attendee list from the registration report: First Name, Last Name, Company Name,
--   Invitee Status, Primary Registrant (Guest of), Registration Type. Search, filters, PDF and Excel are in the app.
--   Re-importing only adds and updates: a row whose first and last name match someone already on the event's list
--   (ignoring capitals and extra spaces) updates that person. When two people share a name, the company decides
--   which (an exact name AND company match is tried first, then name only). Nobody is ever removed.
--   Admins choose, per event, which non-admin people can view the list; they see every column. People get an
--   in-app notice when they are given access.
-- Revision conflicts use PT409 (never 40001; see 20261029120000). Run exactly once (it renames functions).

create table public.attendees (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text not null check (length(last_name) between 1 and 100),
  company text not null default '' check (length(company) <= 200),
  invitee_status text not null default '' check (length(invitee_status) <= 60),
  guest_of text not null default '' check (length(guest_of) <= 200),
  registration_type text not null default '' check (length(registration_type) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index attendees_event_name_idx on public.attendees(event_id, lower(last_name), lower(first_name));
create table public.attendee_viewers (
  event_id integer not null references public.events(id) on delete cascade,
  person_id integer not null references public.people(id) on delete cascade,
  primary key (event_id, person_id)
);
create index attendee_viewers_person_idx on public.attendee_viewers(person_id);

-- Everything goes through ops_snapshot / ops_command.
alter table public.attendees enable row level security;
alter table public.attendee_viewers enable row level security;
revoke all on public.attendees, public.attendee_viewers from anon, authenticated;

-- One cell from the import: trimmed, inner runs of spaces made single.
create function ops_private.attendee_text(v text) returns text language sql immutable set search_path = '' as $$
  select regexp_replace(btrim(replace(coalesce(v, ''), chr(160), ' ')), '\s+', ' ', 'g');
$$;
revoke all on function ops_private.attendee_text(text) from public, anon, authenticated;

-- Snapshot: "attendees": admins get every event's list; others only the lists they were given access to, in open
-- events. Each: {id, ev, f, l, c, st, g, rt}. "attViewers": admins get [{ev, e}] for every event; others their own.
alter function public.ops_snapshot() rename to ops_snapshot_v24;
alter function public.ops_snapshot_v24() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v24() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v24();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object(
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'ev', a.event_id, 'f', a.first_name, 'l', a.last_name, 'c', a.company,
        'st', a.invitee_status, 'g', a.guest_of, 'rt', a.registration_type) order by a.event_id, lower(a.last_name), lower(a.first_name), a.id)
      from public.attendees a
      where admin or (pid is not null and ops_private.event_open(a.event_id)
        and exists(select 1 from public.attendee_viewers v where v.event_id = a.event_id and v.person_id = pid))), '[]'::jsonb),
    'attViewers', coalesce((select jsonb_agg(jsonb_build_object('ev', v.event_id, 'e', v.person_id) order by v.event_id, v.person_id)
      from public.attendee_viewers v
      where admin or (pid is not null and v.person_id = pid and ops_private.event_open(v.event_id))), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands (admins only):
--   importAttendees    [eventId, [{f, l, c, st, g, rt}, ...]]   adds and updates, never removes (up to 5,000 rows)
--   setAttendeeViewers [eventId, [personId, ...]]                the non-admin people who can view the event's list
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v25;
alter function public.ops_command_v25(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v25(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; lst jsonb; r jsonb; n integer; i integer; pass integer; x integer; used integer[] := '{}'; hit integer[];
  f text; l text; c text; st text; g text; rt text; n_new integer := 0; n_upd integer := 0; before integer[]; after integer[]; evname text;
begin
  if action not in ('importAttendees', 'setAttendeeViewers') then
    return ops_private.ops_command_v25(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = 'PT409';
  end if;
  eid := (args->>0)::integer;
  select name into evname from public.events where id = eid;
  if evname is null then raise exception 'Choose an event.'; end if;

  if action = 'importAttendees' then
    lst := args->1;
    if jsonb_typeof(lst) <> 'array' or jsonb_array_length(lst) = 0 then raise exception 'There are no attendees to import.'; end if;
    n := jsonb_array_length(lst);
    if n > 5000 then raise exception 'Import up to 5,000 attendees at a time.'; end if;
    for i in 0 .. n - 1 loop
      r := lst->i;
      if jsonb_typeof(r) <> 'object' then raise exception 'Invalid attendee row.'; end if;
      f := ops_private.attendee_text(r->>'f'); l := ops_private.attendee_text(r->>'l'); c := ops_private.attendee_text(r->>'c');
      st := ops_private.attendee_text(r->>'st'); g := ops_private.attendee_text(r->>'g'); rt := ops_private.attendee_text(r->>'rt');
      if f = '' or l = '' then raise exception 'Every attendee needs a first and last name.'; end if;
      if length(f) > 100 or length(l) > 100 then raise exception 'Names can be up to 100 characters (%, %).', l, f; end if;
      if length(c) > 200 or length(g) > 200 or length(st) > 60 or length(rt) > 60 then raise exception 'A value is too long for %, %.', l, f; end if;
    end loop;
    -- Match: exact name and company first, then name only; each existing attendee is matched at most once.
    hit := array_fill(null::integer, array[n]);
    for pass in 1 .. 2 loop
      for i in 0 .. n - 1 loop
        continue when hit[i + 1] is not null;
        r := lst->i;
        f := ops_private.attendee_text(r->>'f'); l := ops_private.attendee_text(r->>'l'); c := ops_private.attendee_text(r->>'c');
        select a.id into x from public.attendees a
          where a.event_id = eid and lower(a.first_name) = lower(f) and lower(a.last_name) = lower(l) and not (a.id = any(used))
            and (pass = 2 or lower(a.company) = lower(c))
          order by a.id limit 1;
        if x is not null then hit[i + 1] := x; used := used || x; x := null; end if;
      end loop;
    end loop;
    for i in 0 .. n - 1 loop
      r := lst->i;
      f := ops_private.attendee_text(r->>'f'); l := ops_private.attendee_text(r->>'l'); c := ops_private.attendee_text(r->>'c');
      st := ops_private.attendee_text(r->>'st'); g := ops_private.attendee_text(r->>'g'); rt := ops_private.attendee_text(r->>'rt');
      if hit[i + 1] is null then
        insert into public.attendees(event_id, first_name, last_name, company, invitee_status, guest_of, registration_type)
          values(eid, f, l, c, st, g, rt) returning id into x;
        used := used || x;
        n_new := n_new + 1;
      else
        update public.attendees set first_name = f, last_name = l, company = c, invitee_status = st, guest_of = g, registration_type = rt, updated_at = now()
          where id = hit[i + 1] and (first_name, last_name, company, invitee_status, guest_of, registration_type) is distinct from (f, l, c, st, g, rt);
        if found then n_upd := n_upd + 1; end if;
      end if;
    end loop;
    insert into public.activity_log(actor_id, action, details)
      values(auth.uid(), action, jsonb_build_object('event_id', eid, 'rows', n, 'added', n_new, 'updated', n_upd));

  else
    if jsonb_typeof(args->1) <> 'array' or jsonb_array_length(args->1) > 500 then raise exception 'Choose up to 500 people.'; end if;
    select coalesce(array_agg(person_id), '{}') into before from public.attendee_viewers where event_id = eid;
    select coalesce(array_agg(distinct p.id), '{}') into after from jsonb_array_elements_text(args->1) t(val)
      join public.people p on p.id = t.val::integer and not p.archived and p.account_type <> 'admin';
    delete from public.attendee_viewers where event_id = eid and not (person_id = any(after));
    insert into public.attendee_viewers(event_id, person_id) select eid, y from unnest(after) y on conflict do nothing;
    insert into public.notifications(person_id, message)
      select y, 'You can now view the attendee list for ' || evname || '.' from unnest(after) y where not (y = any(before));
    insert into public.activity_log(actor_id, action, details)
      values(auth.uid(), action, jsonb_build_object('event_id', eid, 'people', cardinality(after)));
  end if;
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
