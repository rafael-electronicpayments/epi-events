import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mealLimit } from '../src/expenses.js';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002';

test('mealLimit reads the event row and ignores non-meal types', () => {
  const S = { perDiem: [{ ev: 1, b: 30, l: 40, d: null }] };
  assert.equal(mealLimit(S, 1, 'lunch'), 40);
  assert.equal(mealLimit(S, 1, 'dinner'), null, 'blank = no limit');
  assert.equal(mealLimit(S, 1, 'parking'), null);
  assert.equal(mealLimit(S, 2, 'lunch'), null);
  assert.equal(mealLimit({}, 1, 'lunch'), null, 'older databases: nothing shown');
});

test('per diem limits: standard defaults, per-event edits, everyone sees them, no false conflicts', async () => {
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
    const command = async (action, args, rev) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data', [action, JSON.stringify(args), rev ?? (await snapshot()).revision])).rows[0].data;
    const light = async (action, args, rev) => (await db.query('select public.ops_command_light($1,$2::jsonb,$3) as data', [action, JSON.stringify(args), rev])).rows[0].data;

    await command('addStaff', [{ n: 'Alex Rivera', r: 'Ops', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Bre Binder', r: 'Ops', acct: 'admin', phone: '', map: true }]);
    let data = await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1] }]);
    assert.deepEqual(data.perDiem, [{ ev: 1, b: 30, l: 40, d: 60 }], 'an event starts with the standard limits');
    data = await command('addEvent', [{ n: 'Europe', b: '2026-12-01', d: 2, mon: [1], pd: { b: '25', l: '35.5', d: null } }]);
    assert.deepEqual(data.perDiem.find(x => x.ev === 2), { ev: 2, b: 25, l: 35.5, d: null }, 'set when the event is added; blank = no limit');

    // Edit one event's limits; the other is untouched; the event's other fields still save.
    data = await command('editEvent', [1, { n: 'IMPACT26 PR', b: '2026-11-05', d: 3, mon: [1], pd: { b: 32, l: 45, d: 70 } }]);
    assert.deepEqual(data.perDiem, [{ ev: 1, b: 32, l: 45, d: 70 }, { ev: 2, b: 25, l: 35.5, d: null }]);
    assert.equal(data.events.find(e => e.id === 1).name, 'IMPACT26 PR');
    await assert.rejects(command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1], pd: { b: -1, l: 40, d: 60 } }]), /between/);
    await assert.rejects(command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1], pd: { b: 'abc', l: 40, d: 60 } }]), /amounts/);
    // Without "pd" the limits stay as they are.
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1] }]);
    assert.deepEqual(data.perDiem[0], { ev: 1, b: 32, l: 45, d: 70 });

    // No false "someone else changed this event": edit again with the revision from the last save.
    const r1 = (await snapshot()).revision;
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1], pd: { b: 30, l: 40, d: 60 } }], r1);
    const r2 = data.revision;
    await command('addRoom', ['Lobby']);   // someone else saves something unrelated meanwhile
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1], pd: { b: 31, l: 40, d: 60 } }], r2);
    assert.equal(data.perDiem[0].b, 31);
    // A real conflict is still caught: an editor opened before that last change.
    await assert.rejects(command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1], pd: { b: 99, l: 40, d: 60 } }], r2), e => e.code === 'PT409');

    // Light saves (the app's normal path) work and return just the revision.
    const rev = (await snapshot()).revision;
    const res = await light('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1], pd: { b: 30, l: 40, d: 60 } }], rev);
    assert.equal(res.light, true);
    assert.deepEqual((await snapshot()).perDiem[0], { ev: 1, b: 30, l: 40, d: 60 });

    // Staff see the limits for open events.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0); insert into auth.users values('${alexUser}','alex@example.test');`);
    await as(alexUser);
    assert.deepEqual((await snapshot()).perDiem.map(x => x.ev), [1, 2]);
    await assert.rejects(command('editEvent', [1, { n: 'X', b: '2026-11-05', d: 3, pd: { b: 1, l: 1, d: 1 } }]), /Administrator|admin/i);
  } finally { await db.close(); }
});
