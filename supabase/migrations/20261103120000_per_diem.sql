-- 2026-11-03 owner request (Expenses, option C of the per diem mockup): per diem limits for personal meals.
--   Each event has a Breakfast, Lunch and Dinner limit (standard $30 / $40 / $60, set in Event setup, blank = no
--   limit). When someone enters a meal expense, the form shows that meal's limit and, if the amount is higher, how
--   much over it is. Expenses over the limit can still be submitted (the approver decides).
--   Snapshot: "perDiem": [{ev, b, l, d}] (admins: every event; others: open events).
--   addEvent / editEvent: the event object may carry "pd": {"b": 30, "l": 40, "d": 60} (null = no limit).
-- Revision conflicts use PT409 (never 40001). Run exactly once (it renames functions).

alter table public.events
  add column per_diem_breakfast numeric(7,2) default 30 check (per_diem_breakfast is null or per_diem_breakfast between 0 and 9999.99),
  add column per_diem_lunch numeric(7,2) default 40 check (per_diem_lunch is null or per_diem_lunch between 0 and 9999.99),
  add column per_diem_dinner numeric(7,2) default 60 check (per_diem_dinner is null or per_diem_dinner between 0 and 9999.99);

alter function public.ops_snapshot() rename to ops_snapshot_v28;
alter function public.ops_snapshot_v28() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v28() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare s jsonb; admin boolean;
begin
  s := ops_private.ops_snapshot_v28();
  if not (s ? 'role') then return s; end if;  -- skipped inside a light or bulk save
  admin := s->>'role' = 'admin';
  return s || jsonb_build_object('perDiem', coalesce((select jsonb_agg(jsonb_build_object('ev', e.id,
      'b', e.per_diem_breakfast, 'l', e.per_diem_lunch, 'd', e.per_diem_dinner) order by e.id)
    from public.events e where admin or ops_private.event_open(e.id)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

alter function public.ops_command(text, jsonb, integer) rename to ops_command_v29;
alter function public.ops_command_v29(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v29(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o jsonb; pd jsonb; result jsonb; target integer; b numeric; l numeric; d numeric;
begin
  if action not in ('addEvent', 'editEvent') then return ops_private.ops_command_v29(action, args, expected_revision); end if;
  o := case when action = 'addEvent' then args->0 else args->1 end;
  if jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o->'pd') is distinct from 'object' then return ops_private.ops_command_v29(action, args, expected_revision); end if;
  pd := o->'pd';
  begin
    b := nullif(pd->>'b', '')::numeric; l := nullif(pd->>'l', '')::numeric; d := nullif(pd->>'d', '')::numeric;
  exception when others then raise exception 'Enter meal limits as amounts, like 30.00.';
  end;
  if coalesce(b, 0) < 0 or coalesce(l, 0) < 0 or coalesce(d, 0) < 0 or greatest(b, l, d) > 9999.99 then
    raise exception 'Meal limits must be between $0.00 and $9,999.99.';
  end if;
  args := case when action = 'addEvent' then jsonb_build_array(o - 'pd') || (args - 0) else jsonb_set(args, '{1}', o - 'pd') end;
  result := ops_private.ops_command_v29(action, args, expected_revision);
  -- Writes are serialized by the ops_state row lock, so the newest event is the one just created.
  target := case when action = 'addEvent' then (select max(id) from public.events) else (args->>0)::integer end;
  update public.events set per_diem_breakfast = round(b, 2), per_diem_lunch = round(l, 2), per_diem_dinner = round(d, 2)
    where id = target and (per_diem_breakfast, per_diem_lunch, per_diem_dinner) is distinct from (round(b, 2), round(l, 2), round(d, 2));
  if found then
    -- This change belongs to the save that just ran (it already moved the revision on), so stamp it like the rest
    -- of that save; otherwise the next edit of this event would be refused as "changed by someone else".
    update ops_private.record_changes set after_rev = (select revision from public.ops_state where id = 1) - 1
      where tbl = 'events' and rid = target and after_rev >= (select revision from public.ops_state where id = 1);
    if result ? 'role' then result := public.ops_snapshot(); end if;
  end if;
  return result;
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
