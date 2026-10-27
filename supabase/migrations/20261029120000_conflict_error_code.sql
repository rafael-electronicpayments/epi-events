-- 2026-10-27 fix: staging CPU near 94%. Every write checks the data revision and, when someone else saved first,
-- raises "Another user changed the data" with SQLSTATE 40001 (serialization_failure). PostgREST treats 40001 as a
-- transient conflict and silently re-runs the whole request, but the stale revision never changes, so the request
-- retried forever inside the database (two stuck requests ran about 870 failing transactions a second, 390 million
-- since 2026-10-14). This switches every function that raises it to SQLSTATE PT409, which PostgREST returns once as
-- HTTP 409 and never retries. The app accepts either code. New code must use PT409 for this conflict, never 40001.
-- Safe to run more than once (the second run finds nothing to change).

do $$
declare f record; n integer := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname in ('public', 'ops_private') and p.prokind = 'f' and p.prosrc ~ 'errcode\s*=\s*''40001'''
  loop
    -- CREATE OR REPLACE keeps the function's owner, grants, SECURITY DEFINER and search_path.
    execute regexp_replace(pg_get_functiondef(f.oid), 'errcode\s*=\s*''40001''', 'errcode = ''PT409''', 'g');
    n := n + 1;
  end loop;
  raise notice 'Revision conflicts now use PT409 in % functions.', n;
end;
$$;
