import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';
const contractorUser = '00000000-0000-0000-0000-000000000003';
const rc = (owner, n) => ({ rp: `${owner}/receipt-${n}.jpg`, rt: 'image/jpeg' });

test('closed events are hidden from staff and contractors and cannot be acted on', async () => {
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
    const count = async table => { await db.exec('set role authenticated'); try { return (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n; } finally { await db.exec('reset role'); } };

    // Two events, each with an activity, assignments, a break, a floorplan, and expenses.
    await asUser(admin);
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 3 }]);
    await command('addEvent', [{ n: 'Impact 2027', b: '2027-03-02', d: 3 }]);
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Pat', r: 'AV', acct: 'contractor', phone: '', map: true }]);
    await command('addSession', ['Old keynote', 'Ballroom', 0, 540, 600, 2, null, 1]);
    await command('addSession', ['New keynote', 'Ballroom', 0, 540, 600, 2, null, 2]);
    for (const [p, s] of [[0, 1], [1, 1], [0, 2], [1, 2]]) await command('assign', [p, s]);
    await command('addBreak', ['lunch', 0, 720, 750, [0, 1], 1]);
    await command('addBreak', ['lunch', 0, 720, 750, [0, 1], 2]);
    await command('addFloorplan', [1, 'Old venue', '1/old.pdf', 100]);
    await command('addFloorplan', [2, 'New venue', '2/new.pdf', 100]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${staffUser}','alex@example.test'),('${contractorUser}','pat@example.test');`);
    const exp = { cat: 'parking', loc: 'Garage', ref: '', date: '2026-11-07', amt: '20', pay: 'cash', reimb: true, notes: '' };
    await asUser(staffUser);
    await command('addExpense', [1, { ...exp, ...rc(0, 1) }]);
    await command('addExpense', [2, { ...exp, ...rc(0, 2) }]);
    let data = await snapshot();
    assert.deepEqual(data.events.map(e => e.id), [1, 2]);

    // Only admins can close.
    await assert.rejects(command('setEventClosed', [1, true]), /Administrator access required/);
    await asUser(admin);
    data = await command('setEventClosed', [1, true]);
    assert.deepEqual(data.closedEvents, [1]);
    assert.equal(data.events.length, 2, 'admins still see closed events');
    assert.equal(data.activities.length, 2);
    assert.equal(data.expenses.length, 2);

    for (const [user, who] of [[staffUser, 0], [contractorUser, 1]]) {
      await asUser(user);
      data = await snapshot();
      assert.deepEqual(data.closedEvents, []);
      assert.deepEqual(data.events.map(e => e.id), [2], 'closed event is not offered');
      assert.ok(data.activities.every(s => s.ev === 2));
      assert.ok(data.asg.every(a => data.activities.some(s => s.id === a.s)), 'no assignments from the closed event');
      assert.ok(data.breaks.every(b => b.ev === 2));
      assert.ok(data.floorplans.every(f => f.ev === 2));
      assert.ok(data.expenses.every(x => x.ev === 2));
      assert.ok(data.notes.every(n => n.aid == null || data.asg.some(a => a.id === n.aid)), 'no notices about closed assignments');
      // Direct table reads follow the same rule.
      assert.equal(await count('events'), 1);
      assert.equal(await count('activities'), 1);
      assert.equal(await count('assignments'), 1);
      assert.equal(await count('breaks'), 1);
      assert.equal(await count('floorplans'), 1);
      // Nothing in the closed event can be acted on.
      const closedAsg = (await db.query('select a.id from public.assignments a join public.activities s on s.id = a.activity_id where s.event_id = 1 and a.person_id = $1', [who])).rows[0].id;
      await assert.rejects(command('ack', [closedAsg]), /This event is closed/);
      await assert.rejects(command('addExpense', [1, { ...exp, ...rc(who, 10 + who) }]), /This event is closed/);
    }
    await asUser(staffUser);
    await assert.rejects(command('editExpense', [1, { ...exp, ...rc(0, 1) }]), /This event is closed/);
    await assert.rejects(command('delExpense', [1]), /This event is closed/);
    await assert.rejects(command('clockOut', ['lunch', 1]), /This event is closed/);
    data = await command('ack', [3]);
    assert.equal(data.asg.find(a => a.id === 3).ack, 1, 'open events keep working');
    data = await command('clockOut', ['lunch', 3]);
    assert.equal(data.clocks[0].bid, 3);

    // Admins keep full access and can reopen.
    await asUser(admin);
    data = await command('editExpense', [1, { ...exp, ...rc(0, 1), amt: '22' }]);
    assert.equal(Number(data.expenses.find(x => x.id === 1).amt), 22);
    data = await command('setEventClosed', [1, false]);
    assert.deepEqual(data.closedEvents, []);
    await asUser(staffUser);
    data = await snapshot();
    assert.deepEqual(data.events.map(e => e.id), [1, 2], 'reopened event is visible again');
    assert.equal(data.expenses.length, 2);
    await asUser(admin);
    await assert.rejects(command('setEventClosed', [99, true]), /no longer exists/);
  } finally { await db.close(); }
});
