import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staff = '00000000-0000-0000-0000-000000000002';

test('rooms and activities can turn off acknowledgment and check-in', async () => {
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
    await command('addEvent', [{ n: 'Impact', b: '2027-03-02', d: 2 }]);
    await command('addRoom', ['Ballroom']);
    let data = await command('addRoom', ['Registration', false]);
    assert.deepEqual(data.roomAck, { Ballroom: true, Registration: false });

    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 2, null, 1]);
    await command('addSession', ['Desk', 'Registration', 0, 480, 600, 2, null, 1]);
    data = await command('addSession', ['VIP check-in', 'Registration', 1, 480, 600, 1, true, 1]);
    assert.deepEqual(data.actAck, { 3: true }, 'only overrides are listed');
    // Old-style calls without the flag still work and follow the room.
    data = await command('addSession', ['Lunch', 'Ballroom', 1, 720, 780, 1, 1]);
    assert.equal(data.activities.length, 4);
    assert.deepEqual(data.actAck, { 3: true });

    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('assign', [0, 2]);
    data = await command('ack', [1]);
    const seq = data.asg[0].seq;

    // Changing only the room's setting does not ask anyone to re-acknowledge.
    data = await command('editRoom', ['Registration', 'Registration', true]);
    assert.equal(data.roomAck.Registration, true);
    assert.equal(data.asg[0].ack, 1);
    assert.equal(data.asg[0].seq, seq);
    assert.equal(data.notes.filter(n => !n.done).length, 0);

    // Renaming still notifies as before, and keeps the flag given.
    data = await command('editRoom', ['Registration', 'Front desk', false]);
    assert.deepEqual(data.roomAck, { Ballroom: true, 'Front desk': false });
    assert.equal(data.asg[0].ack, 0);

    // Activity override set and cleared; a flag-only edit does not re-notify.
    data = await command('ack', [1]);
    data = await command('editSession', [2, 'Desk', 'Front desk', 0, 480, 600, 2, true]);
    assert.equal(data.actAck[2], true);
    assert.equal(data.asg[0].ack, 1);
    data = await command('editSession', [2, 'Desk', 'Front desk', 0, 480, 600, 2, null]);
    assert.equal(Object.hasOwn(data.actAck, '2'), false);
    data = await command('editSession', [1, 'Keynote', 'Ballroom', 0, 540, 600, 3]);
    assert.equal(data.activities.find(s => s.id === 1).n, 3, 'old-style edit without flag still works');

    // Staff cannot change settings, and see the flags for their snapshot.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${staff}','alex@example.test');`);
    await asUser(staff);
    data = await snapshot();
    assert.equal(data.role, 'staff');
    assert.equal(data.roomAck['Front desk'], false);
    await assert.rejects(command('editRoom', ['Front desk', 'Front desk', true]), /Administrator access required/);
    await assert.rejects(command('addRoom', ['Sneaky', false]), /Administrator access required/);
    // The private base functions are not callable directly.
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select ops_private.ops_command_base('addRoom','[\"x\"]'::jsonb,0)"), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
