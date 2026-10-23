import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';

test('events keep a venue name, address, and notes that admins set and see', async () => {
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
    const asUser = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data',
      [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;

    await asUser(admin);
    let data = await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, tz: 'America/Puerto_Rico', venue: ' El Conquistador Resort ', addr: '1000 Conquistador Ave\nFajardo, PR 00738', notes: 'Load-in Nov 5, dock B.' }]);
    let e = data.events[0];
    assert.deepEqual([e.venue, e.addr, e.notes, e.tz], ['El Conquistador Resort', '1000 Conquistador Ave\nFajardo, PR 00738', 'Load-in Nov 5, dock B.', 'America/Puerto_Rico']);
    assert.equal(data.eventInfo, true);
    data = await command('addEvent', [{ n: 'Impact 2027', b: '2027-03-02', d: 3 }]);
    assert.deepEqual([data.events[1].venue, data.events[1].addr, data.events[1].notes], ['', '', ''], 'older app: blank fields');
    data = await command('editEvent', [1, { n: 'Impact 26', b: '2026-11-07', d: 6, venue: 'El Conquistador', addr: '1000 Conquistador Ave', notes: '' }]);
    assert.deepEqual([data.events[0].name, data.events[0].venue, data.events[0].addr, data.events[0].notes], ['Impact 26', 'El Conquistador', '1000 Conquistador Ave', '']);
    data = await command('editEvent', [1, { n: 'Impact 2026', b: '2026-11-07', d: 6 }]);
    assert.deepEqual([data.events[0].name, data.events[0].venue], ['Impact 2026', 'El Conquistador'], 'an edit without the fields keeps them');
    await assert.rejects(command('editEvent', [1, { n: 'Impact 2026', b: '2026-11-07', d: 6, venue: 'x'.repeat(201) }]), /up to 200 characters/);

    // Staff don't get the event notes.
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 1, null, 1]);
    await command('assign', [0, 1]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${staffUser}','alex@example.test');`);
    await asUser(staffUser);
    data = await snapshot();
    assert.equal(data.events[0].notes, undefined);
    assert.equal(data.eventInfo, undefined);
  } finally { await db.close(); }
});
