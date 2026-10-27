-- 2026-10-27 owner request: an activity can "Allow overlap". Leads who monitor a long activity (Staff Departures,
-- Registration, all-day items) are often also on other activities at the same time; when either activity allows
-- overlap, those assignments are not flagged as overlapping. The run-of-show import ticks it for all-day rows
-- (6:00 AM-10:00 PM). The overlap warnings are worked out in the app; this only stores the setting. Run exactly once.

alter table public.activities add column allow_overlap boolean not null default false;

-- Snapshot: everything from before, plus per activity "ov": true when overlap is allowed; "overlapOption": true
-- tells the app this database supports it.
alter function public.ops_snapshot() rename to ops_snapshot_v20;
alter function public.ops_snapshot_v20() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v20() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v20();
  return snapshot || jsonb_build_object('overlapOption', true,
    'activities', coalesce((select jsonb_agg(x || case when exists(select 1 from public.activities s
        where s.id = (x->>'id')::integer and s.allow_overlap) then jsonb_build_object('ov', true) else '{}'::jsonb end order by n)
      from jsonb_array_elements(snapshot->'activities') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands:
--   addSession / editSession: the last argument {det, nt, by} may also carry "ov" (true / false).
--   importSchedule: each row may carry "ov"; when present it sets the activity's Allow overlap.
-- Everything else goes to the previous command function unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v20;
alter function public.ops_command_v20(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v20(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare info jsonb; ov boolean; result jsonb; target integer; r jsonb; n integer := 0;
begin
  if action in ('addSession', 'editSession') then
    if jsonb_typeof(args) = 'array' and jsonb_array_length(args) > 0 and jsonb_typeof(args->-1) = 'object' and (args->-1) ? 'ov' then
      info := args->-1;
      ov := coalesce((info->>'ov')::boolean, false);
      args := jsonb_set(args, array[(jsonb_array_length(args) - 1)::text], info - 'ov');
    end if;
    result := ops_private.ops_command_v20(action, args, expected_revision);
    if ov is not null then
      -- Writes are serialized by the ops_state row lock, so the newest activity is the one just created.
      target := case when action = 'addSession' then (select max(id) from public.activities) else (args->>0)::integer end;
      update public.activities set allow_overlap = ov where id = target and allow_overlap <> ov;
      if found then result := public.ops_snapshot(); end if;
    end if;
    return result;
  end if;
  result := ops_private.ops_command_v20(action, args, expected_revision);
  if action = 'importSchedule' then
    -- The import matches activities by event, day, and name; apply each row's setting the same way.
    for r in select * from jsonb_array_elements(args->2) loop
      if r ? 'ov' then
        update public.activities set allow_overlap = coalesce((r->>'ov')::boolean, false)
          where event_id = (args->>0)::integer and day = (r->>'day')::integer
            and lower(btrim(title)) = lower(btrim(r->>'title')) and allow_overlap <> coalesce((r->>'ov')::boolean, false);
        if found then n := n + 1; end if;
      end if;
    end loop;
    if n > 0 then result := public.ops_snapshot(); end if;
  end if;
  return result;
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
