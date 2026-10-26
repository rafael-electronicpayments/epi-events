-- 2026-10-23 owner request: each event record in Event setup gets a Venue name, an Address, and a Notes text box,
-- below the existing fields. Admins set and see them. Run exactly once.

alter table public.events
  add column venue text not null default '' check (length(venue) <= 200),
  add column address text not null default '' check (length(address) <= 500),
  add column notes text not null default '' check (length(notes) <= 4000);

-- Snapshot: admins get each event's "venue", "addr", and "notes"; "eventInfo": true tells the app this database has them.
alter function public.ops_snapshot() rename to ops_snapshot_v10;
alter function public.ops_snapshot_v10() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v10() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := ops_private.ops_snapshot_v10();
  if snapshot->>'role' <> 'admin' then return snapshot; end if;
  return snapshot || jsonb_build_object('eventInfo', true,
    'events', coalesce((select jsonb_agg(x || coalesce((select jsonb_build_object('venue', e.venue, 'addr', e.address, 'notes', e.notes)
        from public.events e where e.id = (x->>'id')::integer), '{}'::jsonb) order by n)
      from jsonb_array_elements(snapshot->'events') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;

-- Commands: addEvent [{..., venue, addr, notes}] and editEvent [id, {..., venue, addr, notes}] also save these
-- (each optional; an edit without them leaves them unchanged). Everything else is unchanged.
alter function public.ops_command(text, jsonb, integer) rename to ops_command_v10;
alter function public.ops_command_v10(text, jsonb, integer) set schema ops_private;
revoke all on function ops_private.ops_command_v10(text, jsonb, integer) from public, anon, authenticated;

create function public.ops_command(action text, args jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o jsonb; result jsonb; target integer; has boolean := false;
begin
  if action in ('addEvent', 'editEvent') then
    o := case when action = 'addEvent' then args->0 else args->1 end;
    has := jsonb_typeof(o) = 'object' and (o ? 'venue' or o ? 'addr' or o ? 'notes');
    if has and (length(coalesce(o->>'venue', '')) > 200 or length(coalesce(o->>'addr', '')) > 500 or length(coalesce(o->>'notes', '')) > 4000) then
      raise exception 'Venue name can be up to 200 characters, address 500, and notes 4,000.';
    end if;
  end if;
  result := ops_private.ops_command_v10(action, args, expected_revision);
  if has then
    -- Writes are serialized by the ops_state row lock, so the newest event is the one just created.
    target := case when action = 'addEvent' then (select max(id) from public.events) else (args->>0)::integer end;
    update public.events set
        venue = case when o ? 'venue' then btrim(coalesce(o->>'venue', '')) else venue end,
        address = case when o ? 'addr' then btrim(coalesce(o->>'addr', '')) else address end,
        notes = case when o ? 'notes' then btrim(coalesce(o->>'notes', '')) else notes end
      where id = target;
    result := public.ops_snapshot();
  end if;
  return result;
end;
$$;
revoke all on function public.ops_command(text, jsonb, integer) from public, anon;
grant execute on function public.ops_command(text, jsonb, integer) to authenticated;
