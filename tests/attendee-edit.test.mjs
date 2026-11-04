import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { isAccepted, STATUSES, attendeeDoc } from '../src/attendees.js';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002';

test('status helpers and PDF styling', () => {
  assert.deepEqual(STATUSES, ['Accepted', 'Canceled', 'Pending', 'Denied']);
  assert.equal(isAccepted({ st: ' accepted ' }), true, 'capitals and spaces from imports do not matter');
  assert.equal(isAccepted({ st: 'Pending' }), false);
  assert.equal(isAccepted({ st: 'Accepted' }), true);
  const doc = attendeeDoc('T', [['A', 'B', '', 'Accepted', '', ''], ['C', 'D', '', 'Canceled', '', '']], 'x');
  assert.match(doc, /<td><b>Accepted<\/b><\/td>/);
  assert.match(doc, /<tr class="na"><td>C<\/td>/);
});

test('editAttendee: admins edit any field; status limited to the four (or the imported one kept)', async () => {
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
    await command('addStaff', [{ n: 'Alex Rivera', r: 'Ops', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Bre Binder', r: 'Ops', acct: 'admin', phone: '', map: true }]);
    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [1] }]);
    let data = await command('importAttendees', [1, [{ f: 'Sam', l: 'Lee', c: 'Acme', st: 'Waitlisted', g: 'Lee, Sam', rt: 'Attendee' }]]);
    assert.equal(data.attendeeEdit, true);
    const id = data.attendees[0].id;
    // Imported status outside the list can be kept while other fields change.
    data = await command('editAttendee', [id, { f: 'Sam', l: 'Lee', c: 'Acme Inc', st: 'Waitlisted', g: 'Lee, Sam', rt: 'Sponsor' }]);
    assert.deepEqual([data.attendees[0].c, data.attendees[0].st, data.attendees[0].rt], ['Acme Inc', 'Waitlisted', 'Sponsor']);
    for (const st of ['Canceled', 'Pending', 'Denied', 'Accepted']) {
      data = await command('editAttendee', [id, { f: ' Sam ', l: 'Lee', c: 'Acme Inc', st, g: 'Lee, Sam', rt: 'Sponsor' }]);
      assert.equal(data.attendees[0].st, st);
      assert.equal(data.attendees[0].f, 'Sam', 'trimmed');
    }
    await assert.rejects(command('editAttendee', [id, { f: 'Sam', l: 'Lee', c: '', st: 'Waitlisted', g: '', rt: '' }]), /Accepted, Canceled, Pending or Denied/, 'the old imported status cannot come back once changed');
    await assert.rejects(command('editAttendee', [id, { f: '', l: 'Lee', c: '', st: 'Accepted', g: '', rt: '' }]), /first and last name/);
    await assert.rejects(command('editAttendee', [999, { f: 'A', l: 'B', st: 'Accepted' }]), /no longer exists/);
    // Light saves (the app's normal path).
    const rev = (await snapshot()).revision;
    const res = (await db.query('select public.ops_command_light($1,$2::jsonb,$3) j', ['editAttendee', JSON.stringify([id, { f: 'Sam', l: 'Lee', c: 'Acme', st: 'Pending', g: '', rt: 'Attendee' }]), rev])).rows[0].j;
    assert.equal(res.light, true);
    assert.equal((await snapshot()).attendees[0].st, 'Pending');
    // Staff can't edit.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0); insert into auth.users values('${alexUser}','alex@example.test');`);
    await as(alexUser);
    await assert.rejects(command('editAttendee', [id, { f: 'X', l: 'Y', st: 'Accepted' }]), /Administrator/);
  } finally { await db.close(); }
});
