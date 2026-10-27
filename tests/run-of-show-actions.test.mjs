import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';

test('activities can have no staff number, no end time, and a Managed by note; import follows suit', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin');
      insert into auth.users values('${admin}','admin@example.test');`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data',
      [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;

    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, tz: 'America/Puerto_Rico' }]);
    await command('addRoom', ['Event Hall']);
    await command('addStaff', [{ n: 'Alex Rivera', r: 'Host', acct: 'staff', phone: '', map: false }]);
    let data = await snapshot();
    assert.equal(data.runOfShow, true);

    // One-moment action, no staff needed, run by Encore.
    data = await command('addSession', ['Close event hall doors', 'Event Hall', 0, 540, 540, 0, null, 1, { det: 'Doors close for keynote', nt: '', by: '  Encore AV ' }]);
    let act = data.activities.find(a => a.t === 'Close event hall doors');
    assert.deepEqual([act.a, act.b, act.n, act.m, act.det], [540, 540, 0, 'Encore AV', 'Doors close for keynote']);
    // Staff can still be assigned to it.
    data = await command('assign', [0, act.id]);
    assert.equal(data.asg.filter(x => x.s === act.id).length, 1);
    // Edit: clear Managed by, give it an end time; details still saved.
    data = await command('editSession', [act.id, 'Close event hall doors', 'Event Hall', 0, 540, 555, 0, null, { det: 'x', nt: 'y', by: '' }]);
    act = data.activities.find(a => a.id === act.id);
    assert.deepEqual([act.b, act.m, act.det, act.nt], [555, undefined, 'x', 'y']);
    // Older clients (no "by") leave Managed by alone.
    await command('editSession', [act.id, 'Close event hall doors', 'Event Hall', 0, 540, 555, 0, null, { det: 'x', nt: 'y', by: 'Encore' }]);
    data = await command('editSession', [act.id, 'Close event hall doors', 'Event Hall', 0, 540, 560, 0, null, { det: 'x', nt: 'y' }]);
    assert.equal(data.activities.find(a => a.id === act.id).m, 'Encore');
    await assert.rejects(command('addSession', ['Bad', 'Event Hall', 0, 600, 540, 0, null, 1]), /check/);
    await assert.rejects(command('addSession', ['Long', 'Event Hall', 0, 600, 660, 0, null, 1, { det: '', nt: '', by: 'x'.repeat(121) }]), /120 characters/);

    // Import: start-only row (end = start) and nobody named -> Staff needed 0; named people -> that number.
    data = await command('importSchedule', [1, {}, [
      { title: 'Lights down', room: 'Event Hall', day: 1, start: 600, end: 600, det: '', leads: [], members: [] },
      { title: 'Registration', room: 'Event Hall', day: 1, start: 420, end: 600, det: '', leads: [0], members: [] }]]);
    const by = Object.fromEntries(data.activities.map(a => [a.t, a]));
    assert.deepEqual([by['Lights down'].a, by['Lights down'].b, by['Lights down'].n], [600, 600, 0]);
    assert.equal(by['Registration'].n, 1);
    await assert.rejects(command('importSchedule', [1, {}, [{ title: 'Oops', room: 'Event Hall', day: 1, start: 600, end: 500, leads: [], members: [] }]]), /start and stop/);
  } finally { await db.close(); }
});
