-- 2026-10-27 owner request: Session Support (Planning › Session Support, under Schedule).
--   The general sessions and breakouts, each with who supports it, in two boxes: Notetakers and Moderators / Q&A Mics.
--   Each box holds named groups ("Notetaker", "Notes & pull quotes", "Q&A mics", "Help with doors") of people from
--   People, plus its own notes. Imported from the session support workbook (one tab per day) and edited by admins.
--   Admins see every card; staff and contractors see only the cards they are on, with everything on them (including
--   the other people's names). Separate from the Schedule: no acknowledgment or check-in. People get an in-app notice
--   when added or removed; a push only when an admin adds them by hand (never during an import).
-- Run exactly once (it renames functions).

create table public.support_sessions (
  id integer generated always as identity primary key,
  event_id integer not null references public.events(id) on delete cascade,
  day integer not null check (day between 0 and 13),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute between 0 and 1440),
  block text not null default '' check (length(block) <= 120),
  track text not null default '' check (length(track) <= 120),
  title text not null check (length(btrim(title)) between 1 and 200),
  room text not null default '' check (length(room) <= 120),
  speakers text not null default '' check (length(speakers) <= 1000),
  is_break boolean not null default false,
  note text not null default '' check (length(note) <= 500),
  roles jsonb not null default '[]'::jsonb check (jsonb_typeof(roles) = 'array'),
  nt_notes text not null default '' check (length(nt_notes) <= 2000),
  md_notes text not null default '' check (length(md_notes) <= 2000),
  check (end_minute >= start_minute)
);
create index support_sessions_event_idx on public.support_sessions(event_id, day, start_minute);
create table public.support_people (
  session_id integer not null references public.support_sessions(id) on delete cascade,
  box text not null check (box in ('nt', 'md')),
  role text not null check (length(btrim(role)) between 1 and 60),
  person_id integer not null references public.people(id) on delete cascade,
  sort integer not null default 0,
  primary key (session_id, box, role, person_id)
);
create index support_people_person_idx on public.support_people(person_id);

-- Everything goes through ops_snapshot / ops_command.
alter table public.support_sessions enable row level security;
alter table public.support_people enable row level security;
revoke all on public.support_sessions, public.support_people from anon, authenticated;

-- "Tue, Nov 10, 9:00 AM" for notices.
create function ops_private.support_when(s public.support_sessions) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(to_char(e.start_date + s.day, 'FMDy, Mon FMDD') || ', ', '') || to_char(time '00:00' + make_interval(mins => s.start_minute), 'FMHH12:MI AM')
  from public.events e where e.id = s.event_id;
$$;
revoke all on function ops_private.support_when(public.support_sessions) from public, anon, authenticated;

-- Snapshot: "support": admins get every card; others only the cards they are on, in open events. Each card:
-- {id, ev, d, a, b, blk, trk, t, r, sp, brk, note, roles: [{box, label}], ppl: [{box, role, e, n}], ntn, mdn}.
alter function public.ops_snapshot() rename to ops_snapshot_v21;
alter function public.ops_snapshot_v21() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v21() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean; pid integer;
begin
  snapshot := ops_private.ops_snapshot_v21();
  admin := snapshot->>'role' = 'admin';
  pid := (snapshot->>'me')::integer;
  return snapshot || jsonb_build_object('support', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'ev', s.event_id, 'd', s.day, 'a', s.start_minute, 'b', s.end_minute, 'blk', s.block, 'trk', s.track, 't', s.title,
      'r', s.room, 'sp', s.speakers, 'brk', s.is_break, 'note', s.note, 'roles', s.roles, 'ntn', s.nt_notes, 'mdn', s.md_notes,
      'ppl', coalesce((select jsonb_agg(jsonb_build_object('box', sp.box, 'role', sp.role, 'e', sp.person_id, 'n', p.name) order by sp.box, sp.sort, p.name)
        from public.support_people sp join public.people p on p.id = sp.person_id where sp.session_id = s.id and not p.archived), '[]'::jsonb))
      order by s.event_id, s.day, s.start_minute, s.id)
    from public.support_sessions s
    where admin or (pid is not null and ops_private.event_open(s.event_id)
      and exists(select 1 from public.support_people x where x.session_id = s.id and x.person_id = pid))), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Shared checks for a card's fields (o: {d, a, b, blk, trk, t, r, sp, brk, note, roles}).
create function ops_private.support_fields(eid integer, o jsonb) returns public.support_sessions
language plpgsql stable security definer set search_path = '' as $$
declare s public.support_sessions; ev public.events; r jsonb;
begin
  select * into ev from public.events where id = eid;
  if ev.id is null then raise exception 'Choose an event.'; end if;
  s.event_id := eid;
  s.title := btrim(coalesce(o->>'t', ''));
  if s.title = '' or length(s.title) > 200 then raise exception 'Every session needs a title (up to 200 characters).'; end if;
  s.day := (o->>'d')::integer; s.start_minute := (o->>'a')::integer; s.end_minute := (o->>'b')::integer;
  if s.day is null or s.day < 0 or s.day >= ev.days then raise exception '% is outside the event''s days.', s.title; end if;
  if s.start_minute is null or s.end_minute is null or s.start_minute < 0 or s.start_minute > 1439 or s.end_minute > 1440 or s.end_minute < s.start_minute then
    raise exception 'Check the start and end times for %.', s.title;
  end if;
  s.block := left(btrim(coalesce(o->>'blk', '')), 120); s.track := left(btrim(coalesce(o->>'trk', '')), 120);
  s.room := left(btrim(coalesce(o->>'r', '')), 120); s.speakers := left(btrim(coalesce(o->>'sp', '')), 1000);
  s.is_break := coalesce((o->>'brk')::boolean, false); s.note := left(btrim(coalesce(o->>'note', '')), 500);
  s.roles := '[]'::jsonb;
  if jsonb_typeof(o->'roles') = 'array' then
    for r in select * from jsonb_array_elements(o->'roles') loop
      if r->>'box' in ('nt', 'md') and length(btrim(coalesce(r->>'label', ''))) between 1 and 60
        and not s.roles @> jsonb_build_array(jsonb_build_object('box', r->>'box', 'label', btrim(r->>'label'))) then
        s.roles := s.roles || jsonb_build_array(jsonb_build_object('box', r->>'box', 'label', btrim(r->>'label')));
      end if;
    end loop;
  end if;
  if jsonb_array_length(s.roles) > 12 then raise exception 'A session can have 12 groups at most.'; end if;
  return s;
end;
$$;
revoke all on function ops_private.support_fields(integer, jsonb) from public, anon, authenticated;

-- Commands (admins only):
--   importSupport    [eventId, rows]          rows: [{d, a, b, blk, trk, t, r, sp, brk, note, roles, ppl: [{box, role, e}]}];
--                                             a row with the same day, start time and title updates that card (notes kept),
--                                             people not on it any more are told; no pushes.
--   saveSupport      [id | null, eventId, o] creates or edits a card's details (o as a row, without ppl)
--   setSupportPeople [id, box, role, [personId, ...]]  sets one group's people; added people get a notice and a push
--   setSupportNotes  [id, box, text]          the box's notes
--   delSupport       [id]                     deletes a card; its people are told
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v22;
alter function public.ops_command_v22(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v22(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; eid integer; r jsonb; f public.support_sessions; s public.support_sessions; sid integer; used integer[] := '{}';
  before integer[]; after integer[]; x integer; bx text; rl text; body text; n_new integer := 0; n_upd integer := 0; i integer;
begin
  if action not in ('importSupport', 'saveSupport', 'setSupportPeople', 'setSupportNotes', 'delSupport') then
    return ops_private.ops_command_v22(action, args, expected_revision);
  end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null or v <> expected_revision then
    raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
  end if;

  if action = 'importSupport' then
    eid := (args->>0)::integer;
    if jsonb_typeof(args->1) <> 'array' or jsonb_array_length(args->1) > 300 then raise exception 'Invalid session list.'; end if;
    for r in select * from jsonb_array_elements(args->1) loop
      f := ops_private.support_fields(eid, r);
      select * into s from public.support_sessions where event_id = eid and day = f.day and start_minute = f.start_minute
        and lower(btrim(title)) = lower(f.title) and not (id = any(used)) order by id limit 1;
      if s.id is null then
        insert into public.support_sessions(event_id, day, start_minute, end_minute, block, track, title, room, speakers, is_break, note, roles)
          values(eid, f.day, f.start_minute, f.end_minute, f.block, f.track, f.title, f.room, f.speakers, f.is_break, f.note, f.roles) returning id into sid;
        n_new := n_new + 1;
      else
        sid := s.id;
        update public.support_sessions set end_minute = f.end_minute, block = f.block, track = f.track, title = f.title, room = f.room,
          speakers = f.speakers, is_break = f.is_break, note = f.note, roles = f.roles where id = sid;
        n_upd := n_upd + 1;
      end if;
      used := used || sid;
      select coalesce(array_agg(distinct person_id), '{}') into before from public.support_people where session_id = sid;
      delete from public.support_people where session_id = sid;
      i := 0;
      for x, bx, rl in select (p->>'e')::integer, p->>'box', left(btrim(p->>'role'), 60) from jsonb_array_elements(coalesce(r->'ppl', '[]')) p loop
        i := i + 1;
        if bx in ('nt', 'md') and rl <> '' and exists(select 1 from public.people where id = x and not archived) then
          insert into public.support_people(session_id, box, role, person_id, sort) values(sid, bx, rl, x, i) on conflict do nothing;
        end if;
      end loop;
      select coalesce(array_agg(distinct person_id), '{}') into after from public.support_people where session_id = sid;
      select * into s from public.support_sessions where id = sid;
      insert into public.notifications(person_id, message)
        select y, 'Session Support: ' || s.title || ' (' || ops_private.support_when(s) || ')' from unnest(after) y where not (y = any(before));
      insert into public.notifications(person_id, message)
        select y, 'Removed from Session Support: ' || s.title from unnest(before) y where not (y = any(after));
    end loop;
    insert into public.activity_log(actor_id, action, details)
      values(auth.uid(), action, jsonb_build_object('event_id', eid, 'added', n_new, 'updated', n_upd));

  elsif action = 'saveSupport' then
    eid := (args->>1)::integer;
    if args->>0 is not null then
      select event_id into eid from public.support_sessions where id = (args->>0)::integer;
      if eid is null then raise exception 'This session no longer exists.'; end if;
    end if;
    f := ops_private.support_fields(eid, args->2);
    if args->>0 is null then
      insert into public.support_sessions(event_id, day, start_minute, end_minute, block, track, title, room, speakers, is_break, note, roles)
        values(eid, f.day, f.start_minute, f.end_minute, f.block, f.track, f.title, f.room, f.speakers, f.is_break, f.note, f.roles) returning id into sid;
    else
      sid := (args->>0)::integer;
      update public.support_sessions set day = f.day, start_minute = f.start_minute, end_minute = f.end_minute, block = f.block, track = f.track,
        title = f.title, room = f.room, speakers = f.speakers, is_break = f.is_break, note = f.note, roles = f.roles where id = sid;
      -- Groups that were removed take their people with them.
      delete from public.support_people sp where sp.session_id = sid
        and not f.roles @> jsonb_build_array(jsonb_build_object('box', sp.box, 'label', sp.role));
    end if;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('session_id', sid, 'title', f.title));

  elsif action = 'setSupportPeople' then
    sid := (args->>0)::integer; bx := args->>1; rl := left(btrim(coalesce(args->>2, '')), 60);
    select * into s from public.support_sessions where id = sid;
    if s.id is null then raise exception 'This session no longer exists.'; end if;
    if bx not in ('nt', 'md') or rl = '' then raise exception 'Choose a group.'; end if;
    if jsonb_typeof(args->3) <> 'array' or jsonb_array_length(args->3) > 50 then raise exception 'Choose up to 50 people.'; end if;
    if not s.roles @> jsonb_build_array(jsonb_build_object('box', bx, 'label', rl)) then
      update public.support_sessions set roles = roles || jsonb_build_array(jsonb_build_object('box', bx, 'label', rl)) where id = sid;
    end if;
    select coalesce(array_agg(distinct person_id), '{}') into before from public.support_people where session_id = sid;
    delete from public.support_people sp where sp.session_id = sid and sp.box = bx and sp.role = rl;
    i := 0;
    for x in select (value)::integer from jsonb_array_elements_text(args->3) loop
      i := i + 1;
      if exists(select 1 from public.people where id = x and not archived) then
        insert into public.support_people(session_id, box, role, person_id, sort) values(sid, bx, rl, x, i) on conflict do nothing;
      end if;
    end loop;
    select coalesce(array_agg(distinct person_id), '{}') into after from public.support_people where session_id = sid;
    body := s.title || ' (' || ops_private.support_when(s) || ')';
    insert into public.notifications(person_id, message)
      select y, 'Session Support: ' || body from unnest(after) y where not (y = any(before));
    insert into public.notifications(person_id, message)
      select y, 'Removed from Session Support: ' || s.title from unnest(before) y where not (y = any(after));
    if to_regclass('public.push_subscriptions') is not null and ops_private.event_open(s.event_id) then
      insert into public.push_outbox(person_id, kind, event_id, title, body, url)
        select y, 'notice', s.event_id, 'Session Support', body, '/'
        from unnest(after) y where not (y = any(before)) and exists(select 1 from public.push_subscriptions ps where ps.person_id = y);
    end if;
    insert into public.activity_log(actor_id, action, details)
      values(auth.uid(), action, jsonb_build_object('session_id', sid, 'title', s.title, 'group', rl, 'people', jsonb_array_length(args->3)));

  elsif action = 'setSupportNotes' then
    sid := (args->>0)::integer; bx := args->>1; body := btrim(coalesce(args->>2, ''));
    if length(body) > 2000 then raise exception 'Notes can be up to 2,000 characters.'; end if;
    if bx = 'nt' then update public.support_sessions set nt_notes = body where id = sid;
    elsif bx = 'md' then update public.support_sessions set md_notes = body where id = sid;
    else raise exception 'Choose a box.'; end if;
    if not found then raise exception 'This session no longer exists.'; end if;

  else
    sid := (args->>0)::integer;
    select * into s from public.support_sessions where id = sid;
    if s.id is null then raise exception 'This session no longer exists.'; end if;
    insert into public.notifications(person_id, message)
      select distinct person_id, 'Session Support cancelled: ' || s.title from public.support_people where session_id = sid;
    delete from public.support_sessions where id = sid;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, jsonb_build_object('session_id', sid, 'title', s.title));
  end if;
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
