import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002';

test('assignMany: many people at once, each through the single assign; repeats and archived skipped', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin'); insert into auth.users values('${admin}','admin@example.test');`);
    const as = uid => db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await as(admin);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data', [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;

    for (const [n, acct] of [['Alex Rivera', 'staff'], ['Pat Quinn', 'contractor'], ['Sam Lee', 'speaker'], ['Gone Person', 'staff']])
      await command('addStaff', [{ n, r: 'Ops', acct, phone: '', map: true }]);
    await command('delStaff', [3]);
    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [] }]).catch(() => command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3 }]));
    await command('addRoom', ['Lobby']);
    let data = await command('addSession', ['Registration', 'Lobby', 0, 480, 600, 3, null, 1]);
    assert.equal(data.assignMany, true);
    const sid = data.activities[0].id;
    await command('assign', [0, sid]);
    data = await command('assignMany', [[0, 1, 2, 3, 1], sid]);
    assert.deepEqual(data.asg.filter(a => a.s === sid).map(a => a.e).sort(), [0, 1, 2]);
    assert.ok(Array.isArray(data.people) && data.people.length >= 3, 'the final snapshot is the full one');
    assert.equal((await snapshot()).assignMany, true, 'the bulk setting does not leak into later snapshots');
    assert.equal((await db.query("select current_setting('ops.bulk', true) as v")).rows[0].v || '', '', 'setting is cleared');
    assert.equal((await db.query("select count(*)::int n from public.notifications where message like 'New assignment%'")).rows[0].n, 3, 'one notice each');
    assert.ok((await db.query("select 1 from public.activity_log where action = 'assignMany' and details->>'assigned' = '2'")).rows.length);
    await assert.rejects(command('assignMany', [[], sid]), /at least one/);
    await assert.rejects(command('assignMany', [[0], 999]), /no longer exists/);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0); insert into auth.users values('${alexUser}','alex@example.test');`);
    await as(alexUser);
    await assert.rejects(command('assignMany', [[1], sid]), /Administrator/);
    await as(admin);
    // Stale saves now go through the outer ops_command (record-level checks, 20261103100000); the inner chain still refuses with PT409.
    await assert.rejects(db.query('select ops_private.ops_command_v28($1,$2::jsonb,$3)', ['assignMany', JSON.stringify([[1], sid]), 0]), e => e.code === 'PT409');
  } finally { await db.close(); }
});
