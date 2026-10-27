import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';

// PostgREST re-runs a request that fails with SQLSTATE 40001 and never stops, because the stale revision never
// changes. Revision conflicts must use PT409 (HTTP 409, no retry).
test('revision conflicts raise PT409, never 40001', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
    const left = (await db.query("select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname in ('public','ops_private') and p.prosrc like '%40001%'")).rows[0].n;
    assert.equal(left, 0, 'no function raises 40001');
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin'); insert into auth.users values('${admin}','admin@example.test');`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const rev = (await db.query('select public.ops_snapshot() as d')).rows[0].d.revision;
    await db.query("select public.ops_command('addRoom', '[\"Lobby\"]'::jsonb, $1)", [rev]);
    for (const [action, args] of [['addRoom', ['Hall']], ['pushTest', [0]], ['sendReminder', [1, [0], 'Hi']], ['importSupport', [1, []]]]) {
      await assert.rejects(db.query('select public.ops_command($1, $2::jsonb, $3)', [action, JSON.stringify(args), rev]),
        e => e.code === 'PT409' && /Another user changed the data/.test(e.message), action);
    }
    // Running the fix again changes nothing.
    await db.exec(await readFile(new URL('20261029120000_conflict_error_code.sql', dir), 'utf8'));
  } finally { await db.close(); }
});
