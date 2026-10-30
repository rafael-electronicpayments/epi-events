import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { planAttendees, attendeeEffects, filterAttendees, isGuest, sortAttendees, attendeeDoc } from '../src/attendees.js';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002', patUser = '00000000-0000-0000-0000-000000000003';
const HEAD = ['First Name', 'Last Name', 'Company Name', 'Invitee Status', 'Primary Registrant (Guest of)', 'Registration Type'];

test('attendee file: header by meaning, blank rows skipped, problems flagged', () => {
  const p = planAttendees([{ sheet: 'x', rows: [['Report'], HEAD,
    ['Ava', 'Hollis', 'Northwind', 'Accepted', 'Hollis, Ava', 'Attendee'], ['', '', '', '', '', ''],
    [' Ben ', 'Marlowe  Jr', '', 'Accepted', 'Hollis, Ava', 'Sponsor Guest'], ['', 'Quill', 'Lantern', 'Accepted', '', 'Attendee']] }]);
  assert.deepEqual(p.missing, []);
  assert.equal(p.items.length, 3);
  assert.deepEqual([p.items[1].f, p.items[1].l, p.items[1].line], ['Ben', 'Marlowe Jr', 5]);
  assert.match(p.items[2].err, /first and last name/);
  assert.equal(isGuest(p.items[0]), false); assert.equal(isGuest(p.items[1]), true);
  assert.throws(() => planAttendees([{ sheet: 'x', rows: [['Name', 'Email']] }]), /First Name and Last Name/);
  const short = planAttendees([{ sheet: 'x', rows: [['First', 'Last'], ['A', 'B']] }]);
  assert.deepEqual(short.missing, ['Company Name', 'Invitee Status', 'Primary Registrant (Guest of)', 'Registration Type']);
});

test('attendee matching: exact name, company breaks ties, nothing removed', () => {
  const existing = [{ id: 1, f: 'Sam', l: 'Lee', c: 'Acme', st: 'Accepted', g: 'Lee, Sam', rt: 'Attendee' },
    { id: 2, f: 'Sam', l: 'Lee', c: 'Bolt', st: 'Accepted', g: 'Lee, Sam', rt: 'Attendee' },
    { id: 3, f: 'Ava', l: 'Hollis', c: 'Northwind', st: 'Accepted', g: 'Hollis, Ava', rt: 'Attendee' }];
  const row = (f, l, c, rt = 'Attendee') => ({ f, l, c, st: 'Accepted', g: l + ', ' + f, rt, err: '' });
  const fx = attendeeEffects([row('sam', 'LEE', 'Bolt'), row('Sam', 'Lee', 'Acme', 'Sponsor'), row('Ava', 'Hollis', 'Northwind'), row('Ava', 'Hollis', 'Northwind'), row('Ava', 'Hollys', 'Northwind')], existing);
  assert.deepEqual(fx.map(x => [x.kind, x.id]), [['update', 2], ['update', 1], ['same', 3], ['dup', undefined], ['new', undefined]]);
  assert.deepEqual(fx[1].changes, ['Registration Type']);
  // A changed company still finds the person by name.
  assert.deepEqual(attendeeEffects([row('Ava', 'Hollis', 'Southwind')], existing).map(x => [x.kind, x.id]), [['update', 3]]);
  const list = sortAttendees(existing);
  assert.deepEqual(filterAttendees(list, { q: 'lee bolt' }).map(a => a.id), [2]);
  assert.deepEqual(filterAttendees(list, { kind: 'guest' }), []);
  assert.match(attendeeDoc('T', [['<b>', 'x', '', '', '', '']], 'sub'), /&lt;b&gt;/);
});

test('attendees: import adds and updates (never removes), viewers per event see every column', async () => {
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

    for (const [n, acct] of [['Alex Rivera', 'staff'], ['Pat Quinn', 'contractor'], ['Bre Binder', 'admin']])
      await command('addStaff', [{ n, r: 'Ops', acct, phone: '', map: true }]);
    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 9, mon: [2] }]);
    await command('addEvent', [{ n: 'Other', b: '2026-12-05', d: 2, mon: [2] }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${alexUser}','alex@example.test'),('${patUser}','pat@example.test');`);

    const r = (f, l, c, rt = 'Attendee', g = l + ', ' + f) => ({ f, l, c, st: 'Accepted', g, rt });
    let data = await command('importAttendees', [1, [r('Sam', 'Lee', 'Acme'), r('Sam', 'Lee', 'Bolt'), r(' Ava ', 'Hollis', 'Northwind'), r('Ben', 'Marlowe', '', 'Sponsor Guest', 'Hollis, Ava')]]);
    assert.equal(data.attendees.length, 4);
    assert.deepEqual(data.attendees.map(a => [a.l, a.f, a.c]), [['Hollis', 'Ava', 'Northwind'], ['Lee', 'Sam', 'Acme'], ['Lee', 'Sam', 'Bolt'], ['Marlowe', 'Ben', '']]);
    const ids = Object.fromEntries(data.attendees.map(a => [a.f + a.c, a.id]));

    // Re-import: different capitals/spacing update the same people; company decides between the two Sams;
    // someone missing from the file stays; a new name is added.
    data = await command('importAttendees', [1, [r('SAM', 'lee', 'Bolt', 'Sponsor'), r('Sam', 'Lee', 'Acme Inc'), r('Ava', 'Hollis', 'Northwind', 'EPI Staff'), r('Cy', 'Oakes', 'Lantern')]]);
    const by = Object.fromEntries(data.attendees.map(a => [a.id, a]));
    assert.equal(data.attendees.length, 5, 'nobody removed, one added');
    assert.deepEqual([by[ids.SamBolt].rt, by[ids.SamBolt].f, by[ids.SamBolt].l], ['Sponsor', 'SAM', 'lee']);
    assert.equal(by[ids.SamAcme].c, 'Acme Inc');
    assert.equal(by[ids.AvaNorthwind].rt, 'EPI Staff');
    assert.ok(by[ids.Ben], 'Ben stays');
    assert.ok((await db.query("select 1 from public.activity_log where action = 'importAttendees' and details->>'added' = '1' and details->>'updated' = '3'")).rows.length);
    // The other event's list is separate.
    data = await command('importAttendees', [2, [r('Sam', 'Lee', 'Acme')]]);
    assert.equal(data.attendees.filter(a => a.ev === 2).length, 1);
    await assert.rejects(command('importAttendees', [1, [r('', 'X', '')]]), /first and last name/);
    await assert.rejects(command('importAttendees', [1, []]), /no attendees/);

    // Viewers: only non-admins; Alex gets a notice; staff not chosen see nothing.
    data = await command('setAttendeeViewers', [1, [0, 2, 99]]);
    assert.deepEqual(data.attViewers, [{ ev: 1, e: 0 }]);
    assert.equal((await db.query("select count(*)::int n from public.notifications where person_id = 0 and message = 'You can now view the attendee list for IMPACT26.'")).rows[0].n, 1);
    await command('setAttendeeViewers', [1, [0]]);
    assert.equal((await db.query("select count(*)::int n from public.notifications where person_id = 0 and message like 'You can now view%'")).rows[0].n, 1, 'no repeat notice');

    await as(alexUser);
    data = await snapshot();
    assert.deepEqual(data.attViewers, [{ ev: 1, e: 0 }]);
    assert.equal(data.attendees.length, 5);
    assert.ok(data.attendees.every(a => a.ev === 1 && 'g' in a && 'st' in a && 'rt' in a && 'c' in a));
    await assert.rejects(command('importAttendees', [1, [r('A', 'B', '')]]), /Administrator/);
    await assert.rejects(command('setAttendeeViewers', [1, [0]]), /Administrator/);
    await as(patUser);
    data = await snapshot();
    assert.deepEqual([data.attendees, data.attViewers], [[], []]);

    // Closed event: viewers lose access; removing a viewer takes it away.
    await as(admin);
    await command('setEventClosed', [1, true]);
    await as(alexUser);
    assert.deepEqual((await snapshot()).attendees, []);
    await as(admin);
    await command('setEventClosed', [1, false]);
    await command('setAttendeeViewers', [1, []]);
    await as(alexUser);
    assert.deepEqual((await snapshot()).attendees, []);

    // Stale revision is PT409.
    await as(admin);
    await assert.rejects(db.query('select public.ops_command($1,$2::jsonb,$3)', ['importAttendees', JSON.stringify([1, [r('A', 'B', '')]]), 0]), e => e.code === 'PT409');
  } finally { await db.close(); }
});
