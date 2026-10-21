-- 2026-10-21 owner request: show who approved an expense and when, under its date on the Expenses page.
-- Snapshot expenses gain "okBy": the approving admin's roster name. Admins without a roster record show their
-- sign-in email to other admins and "an administrator" to everyone else. Run exactly once.

alter function public.ops_snapshot() rename to ops_snapshot_v8;
alter function public.ops_snapshot_v8() set schema ops_private;
revoke all on function ops_private.ops_snapshot_v8() from public, anon, authenticated;

create function public.ops_snapshot() returns jsonb language plpgsql stable
security definer set search_path = '' as $$
declare snapshot jsonb; admin boolean;
begin
  snapshot := ops_private.ops_snapshot_v8();
  if jsonb_typeof(snapshot->'expenses') <> 'array' then return snapshot; end if;
  admin := snapshot->>'role' = 'admin';
  return snapshot || jsonb_build_object('expenses', coalesce((select jsonb_agg(x || jsonb_build_object('okBy',
      (select coalesce(nullif(btrim(e.name), ''), case when admin then u.email else 'an administrator' end)
        from public.expenses ex
        left join public.profiles f on f.user_id = ex.approved_by
        left join public.people e on e.id = f.person_id
        left join auth.users u on u.id = ex.approved_by
        where ex.id = (x->>'id')::integer and ex.approved and ex.approved_by is not null)) order by n)
    from jsonb_array_elements(snapshot->'expenses') with ordinality t(x, n)), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;
