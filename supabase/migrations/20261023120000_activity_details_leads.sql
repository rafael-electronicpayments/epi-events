-- 2026-10-23 owner request: activities get
--   Details: a text box everyone on the activity sees;
--   Notes: a text box only admins see;
--   Team leads: one or more assigned Staff or Admin people marked as lead. A lead is an assignment, so leads count
--   toward staffing like anyone else, and everyone sees who the leads are. Run exactly once.

alter table public.activities
  add column details text not null default '' check (length(details) <= 2000),
  add column admin_notes text not null default '' check (length(admin_notes) <= 2000);
alter table public.assignments add column lead boolean not null default false;

-- Snapshot: everything from before, plus per activity "det" (details), "nt" (notes, admins only), and "leads"
-- ([{e: person id, n: name}], so contractors who only see their own assignments still see the leads); each
-- assignment gets "lead"; "activityInfo": true tells the app this database supports it.
alter function public.ops_snapshot() rename to ops_snapshot_v9;
alter function public.ops_snapshot_v9() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v9() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean;
begin
  snapshot := ops_private.ops_snapshot_v9();
  admin := snapshot->>'role' = 'admin';
  return snapshot || jsonb_build_object('activityInfo', true,
    'activities', coalesce((select jsonb_agg(x || (select jsonb_build_object('det', s.details,
        'leads', coalesce((select jsonb_agg(jsonb_build_object('e', p.id, 'n', p.name) order by p.name)
          from public.assignments a join public.people p on p.id = a.person_id
          where a.activity_id = s.id and a.lead and not p.archived), '[]'::jsonb))
        || case when admin then jsonb_build_object('nt', s.admin_notes) else '{}'::jsonb end
        from public.activities s where s.id = (x->>'id')::integer) order by n)
      from jsonb_array_elements(snapshot->'activities') with ordinality t(x, n)), '[]'::jsonb),
    'asg', coalesce((select jsonb_agg(x || jsonb_build_object('lead',
        coalesce((select a.lead from public.assignments a where a.id = (x->>'id')::integer), false)) order by n)
      from jsonb_array_elements(snapshot->'asg') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   addSession / editSession take an optional last argument {det, nt} (details and notes; admins only, as before).
--   setLead [assignmentId, true|false] marks an assigned Staff or Admin person as a team lead (admins only).
-- Everything else goes to the previous command function unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v9;
alter function public.ops_command_v9(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v9(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; info jsonb; result jsonb; target integer; pid integer; kind text; det text; nt text;
begin
  if action = 'setLead' then
    if not coalesce(ops_private.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    select revision into v from public.ops_state where id = 1 for update;
    if expected_revision is null or v <> expected_revision then
      raise exception 'Another user changed the data. Refresh and try again.' using errcode = '40001';
    end if;
    select a.person_id, p.account_type into pid, kind from public.assignments a join public.people p on p.id = a.person_id
      where a.id = (args->>0)::integer;
    if pid is null then raise exception 'Assignment no longer exists.'; end if;
    if coalesce((args->>1)::boolean, false) and kind not in ('staff', 'admin') then
      raise exception 'Team leads must be Staff or Admin people.';
    end if;
    update public.assignments set lead = coalesce((args->>1)::boolean, false) where id = (args->>0)::integer;
    insert into public.activity_log(actor_id, action, details) values(auth.uid(), action, args);
    update public.ops_state set revision = revision + 1 where id = 1;
    return public.ops_snapshot();
  end if;
  if action in ('addSession', 'editSession') and jsonb_typeof(args) = 'array' and jsonb_array_length(args) > 0
    and jsonb_typeof(args->-1) = 'object' then
    info := args->-1;
    args := args - (jsonb_array_length(args) - 1);
    det := btrim(coalesce(info->>'det', ''));
    nt := btrim(coalesce(info->>'nt', ''));
    if length(det) > 2000 or length(nt) > 2000 then raise exception 'Details and notes can be up to 2,000 characters each.'; end if;
  end if;
  result := ops_private.ops_command_v9(action, args, expected_revision);
  if info is not null then
    -- Writes are serialized by the ops_state row lock, so the newest activity is the one just created.
    target := case when action = 'addSession' then (select max(id) from public.activities) else (args->>0)::integer end;
    update public.activities set details = det, admin_notes = nt where id = target and (details <> det or admin_notes <> nt);
    if found then result := public.ops_snapshot(); end if;
  end if;
  return result;
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
