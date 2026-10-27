import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';

test('activities can allow overlap, from the editor and the import', async () => {
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
    await command('addRoom', ['Lobby']);
    let data = await snapshot();
    assert.equal(data.overlapOption, true);
    data = await command('addSession', ['Staff Departures', 'Lobby', 0, 360, 1320, 0, null, 1, { det: 'Monitor', nt: '', by: '', ov: true }]);
    let act = data.activities.find(a => a.t === 'Staff Departures');
    assert.deepEqual([act.ov, act.det], [true, 'Monitor']);
    data = await command('editSession', [act.id, 'Staff Departures', 'Lobby', 0, 360, 1320, 0, null, { det: 'Monitor', nt: '', by: 'Bre', ov: false }]);
    act = data.activities.find(a => a.id === act.id);
    assert.deepEqual([act.ov, act.m], [undefined, 'Bre']);
    // Without "ov" the setting is left alone.
    await command('editSession', [act.id, 'Staff Departures', 'Lobby', 0, 360, 1320, 0, null, { det: '', nt: '', ov: true }]);
    data = await command('editSession', [act.id, 'Staff Departures', 'Lobby', 0, 360, 1320, 0, null, { det: 'x', nt: '' }]);
    assert.equal(data.activities.find(a => a.id === act.id).ov, true);
    // Import: rows with "ov" set it; rows without leave it.
    data = await command('importSchedule', [1, {}, [
      { title: 'Staff departures', room: 'Lobby', day: 0, start: 360, end: 1320, det: '', leads: [], members: [], ov: false },
      { title: 'Room checks', room: 'Lobby', day: 1, start: 360, end: 1320, det: '', leads: [], members: [], ov: true },
      { title: 'Doors', room: 'Lobby', day: 1, start: 540, end: 540, det: '', leads: [], members: [] }]]);
    const by = Object.fromEntries(data.activities.map(a => [a.t, a]));
    assert.deepEqual([by['Staff Departures'].ov, by['Room checks'].ov, by['Doors'].ov], [undefined, true, undefined]);
  } finally { await db.close(); }
});
