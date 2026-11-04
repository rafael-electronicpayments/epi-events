-- 2026-11-04 owner request (Attendees): admins can edit an attendee. Invitee Status is one of Accepted, Canceled,
-- Pending, Denied (an imported status outside that list is kept until someone changes it). In the app, Accepted is
-- bold and any other status shows the whole row in red.
--   editAttendee [attendeeId, {f, l, c, st, g, rt}]   admins only
--   Snapshot: "attendeeEdit": true tells the app this database has it.
-- Revision conflicts use PT409 (never 40001). Run exactly once (it renames functions).

alter function public.ops_snapshot() rename to ops_snapshot_v29;
alter function public.ops_snapshot_v29() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v29() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare s jsonb;
begin
  s := ops_private.ops_snapshot_v29();
  if not (s ? 'role') then return s; end if;  -- skipped inside a light or bulk save
  return s || jsonb_build_object('attendeeEdit', true);
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

alter function public.ops_command(text, jsonb, integer) rename to ops_command_v30;
alter function public.ops_command_v30(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v30(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; a public.attendees; o jsonb; f text; l text; c text; st text; g text; rt text;
begin
  if action <> 'editAttendee' then return ops_private.ops_command_v30(action, args, expected_revision); end if;
  if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  select revision into v from public.ops_state where id = 1 for update;
  if expected_revision is null then raise exception 'Another user changed the data. Refresh and try again.' using errcode = 'PT409'; end if;
  select * into a from public.attendees where id = (args->>0)::integer;
  if a.id is null then raise exception 'This attendee no longer exists.'; end if;
  o := args->1;
  if jsonb_typeof(o) is distinct from 'object' then raise exception 'Invalid attendee.'; end if;
  f := ops_private.attendee_text(o->>'f'); l := ops_private.attendee_text(o->>'l'); c := ops_private.attendee_text(o->>'c');
  st := ops_private.attendee_text(o->>'st'); g := ops_private.attendee_text(o->>'g'); rt := ops_private.attendee_text(o->>'rt');
  if f = '' or l = '' then raise exception 'Enter a first and last name.'; end if;
  if length(f) > 100 or length(l) > 100 or length(c) > 200 or length(g) > 200 or length(rt) > 60 then raise exception 'A value is too long.'; end if;
  if not (st in ('Accepted', 'Canceled', 'Pending', 'Denied') or st = a.invitee_status) then
    raise exception 'Choose an invitee status: Accepted, Canceled, Pending or Denied.';
  end if;
  update public.attendees set first_name = f, last_name = l, company = c, invitee_status = st, guest_of = g, registration_type = rt, updated_at = now()
    where id = a.id and (first_name, last_name, company, invitee_status, guest_of, registration_type) is distinct from (f, l, c, st, g, rt);
  insert into public.activity_log(actor_id, action, details)
    values(auth.uid(), action, jsonb_build_object('attendee_id', a.id, 'event_id', a.event_id, 'name', f || ' ' || l, 'status', st));
  update public.ops_state set revision = revision + 1 where id = 1;
  return public.ops_snapshot();
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
