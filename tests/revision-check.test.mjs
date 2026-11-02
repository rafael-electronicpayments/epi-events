import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('ops_revision: the revision only, for signed-in users, and it moves with every write', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
    const admin = '00000000-0000-0000-0000-000000000001';
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin'); insert into auth.users values('${admin}','admin@example.test');`);
    const rev = async () => (await db.query('select public.ops_revision() r')).rows[0].r;
    assert.equal(await rev(), null, 'not signed in: nothing');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const s = (await db.query('select public.ops_snapshot() j')).rows[0].j;
    assert.equal(await rev(), s.revision);
    await db.query('select public.ops_command($1,$2::jsonb,$3)', ['addRoom', JSON.stringify(['Lobby']), s.revision]);
    assert.equal(await rev(), s.revision + 1);
    const grants = (await db.query("select has_function_privilege('anon', 'public.ops_revision()', 'execute') a, has_function_privilege('authenticated', 'public.ops_revision()', 'execute') b")).rows[0];
    assert.deepEqual([grants.a, grants.b], [false, true]);
  } finally { await db.close(); }
});
