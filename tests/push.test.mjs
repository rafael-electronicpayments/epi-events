import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';
const contractorUser = '00000000-0000-0000-0000-000000000003';
const outsider = '00000000-0000-0000-0000-000000000004';
const sub = (n, host = 'https://fcm.googleapis.com/fcm/send/') => ({
  endpoint: host + 'device-' + n, keys: { p256dh: 'B'.repeat(40) + n, auth: 'authkey-' + n }
});

test('push notifications: devices, queueing, reminders, invalidation, and the sender protocol', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin');
      insert into auth.users values('${admin}','admin@example.test'),('${outsider}','outsider@example.test');`);
    const asUser = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
    const snapshot = async () => (await one('select public.ops_snapshot() as data')).data;
    const command = async (action, args) => (await one('select public.ops_command($1,$2::jsonb,$3) as data',
      [action, JSON.stringify(args), (await snapshot()).revision])).data;
    const register = async (s, device = 'Test phone') => (await one('select public.push_register($1::jsonb,$2) as data', [JSON.stringify(s), device])).data;
    const outbox = async (where = 'true') => (await db.query(`select * from public.push_outbox where ${where} order by id`)).rows;
    const asService = async fn => { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } };
    const claim = () => asService(async () => (await one('select public.push_claim(50) as data')).data);
    const report = results => asService(async () => (await one('select public.push_report($1::jsonb) as data', [JSON.stringify(results)])).data);
    const makeDue = id => db.query("update public.push_outbox set due_at = now() - interval '1 second', next_attempt = now() - interval '1 second' where id = $1", [id]);
    const { tomorrow, today, nowMin } = await one(`select ((now() at time zone 'America/New_York')::date + 1)::text tomorrow,
      (now() at time zone 'America/New_York')::date::text today,
      (extract(hour from now() at time zone 'America/New_York') * 60 + extract(minute from now() at time zone 'America/New_York'))::int "nowMin"`);

    // Setup: an event tomorrow (Eastern by default), a room, two people, and an activity at 9:00 AM.
    await asUser(admin);
    await command('addEvent', [{ n: 'Impact', b: tomorrow, d: 2 }]);
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Pat', r: 'AV', acct: 'contractor', phone: '', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 2, null, 1]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${staffUser}','alex@example.test'),('${contractorUser}','pat@example.test');`);
    let data = await snapshot();
    assert.equal(data.events[0].tz, 'America/New_York', 'events default to Eastern time');
    assert.deepEqual(data.push, { devices: 0 });
    assert.ok(Array.isArray(data.pushStatus) && Array.isArray(data.pushTests) && Array.isArray(data.pushLog), 'admins see enrollment');

    // A new assignment queues an immediate push and a reminder 30 minutes before 9:00 AM Eastern.
    await command('assign', [0, 1]);
    let rows = await outbox('person_id = 0');
    assert.deepEqual(rows.map(r => [r.kind, r.title, r.status]), [['assignment', 'New assignment', 'pending'], ['reminder', 'Starts in 30 minutes', 'pending']]);
    assert.match(rows[0].body, /^Keynote · Ballroom · \w{3}, \w{3} \d{1,2}, 9:00 AM$/);
    assert.equal(rows[0].url, '/?asg=1');
    const due = await one(`select ($1::date + interval '8 hours 30 minutes') at time zone 'America/New_York' as t`, [tomorrow]);
    assert.equal(rows[1].due_at.getTime(), due.t.getTime(), 'reminder is due at 8:30 AM Eastern');

    // Devices: only real push services, only for yourself, only for people on the roster.
    await asUser(outsider);
    await assert.rejects(register(sub(1)), /not been provisioned|Only people on the roster/);
    await asUser(admin);
    await assert.rejects(register(sub(1)), /Only people on the roster/, 'admins without a roster entry have no schedule to push');
    await asUser(staffUser);
    await assert.rejects(register(sub(1, 'https://evil.example.com/')), /not supported/);
    await assert.rejects(register({ ...sub(1), keys: { p256dh: 'short', auth: 'x' } }), /invalid notification keys/);
    assert.deepEqual(await register(sub(1), 'iPhone · Safari'), { devices: 1 });
    assert.deepEqual(await register(sub(2, 'https://web.push.apple.com/'), 'iPad · Safari'), { devices: 2 });
    assert.deepEqual(await register(sub(1), 'iPhone · Safari'), { devices: 2 }, 'registering again updates, not duplicates');
    data = await snapshot();
    assert.deepEqual(data.push, { devices: 2 });
    assert.equal(data.pushStatus, undefined, 'staff do not see enrollment of others');
    await assert.rejects(command('pushTest', [0]), /Administrator access required/);
    // No direct table access.
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from public.push_subscriptions'), /permission denied/);
    await assert.rejects(db.query('select public.push_claim(1)'), /permission denied/);
    await db.exec('reset role');
    // The contractor can't remove Alex's device.
    await asUser(contractorUser);
    assert.deepEqual((await one('select public.push_unregister($1) as data', [sub(1).endpoint])).data, { devices: 0 });
    assert.equal((await one('select count(*)::int n from public.push_subscriptions')).n, 2);

    // Admin enrollment view and test notifications.
    await asUser(admin);
    data = await snapshot();
    const alex = data.pushStatus.find(p => p.e === 0), pat = data.pushStatus.find(p => p.e === 1);
    assert.equal(alex.n, 2);
    assert.deepEqual(alex.devices, ['iPhone · Safari', 'iPad · Safari']);
    assert.equal(pat.n, 0);
    await assert.rejects(command('pushTest', [1]), /Pat hasn't turned on notifications/);
    data = await command('pushTest', [0]);
    assert.deepEqual(data.pushTests.map(t => [t.e, t.st]), [[0, 'pending']]);
    assert.equal(data.log[0].x, 'pushTest');

    // Acknowledging changes nothing; changing the activity's time queues "changed" and replaces the reminder.
    await asUser(staffUser);
    const before = (await outbox()).length;
    await command('ack', [1]);
    assert.equal((await outbox()).length, before, 'acknowledging does not push');
    await asUser(admin);
    await command('editSession', [1, 'Keynote', 'Ballroom', 0, 600, 660, 2, null]);
    rows = await outbox("person_id = 0 and kind <> 'test'");
    assert.deepEqual(rows.map(r => [r.kind, r.title, r.assignment_seq]), [['assignment', 'New assignment', 0],
      ['assignment', 'Assignment changed', 1], ['reminder', 'Starts in 30 minutes', 1]], 'the old reminder is replaced');
    const due930 = await one(`select ($1::date + interval '9 hours 30 minutes') at time zone 'America/New_York' as t`, [tomorrow]);
    assert.equal(rows[2].due_at.getTime(), due930.t.getTime());

    // Changing the event's time zone moves its reminders; a bad zone is refused; editing without tz keeps it.
    await assert.rejects(command('editEvent', [1, { n: 'Impact', b: tomorrow, d: 2, tz: 'Mars/Olympus' }]), /valid time zone/);
    await assert.rejects(command('editEvent', [1, { n: 'Impact', b: tomorrow, d: 2, tz: 'EST; drop table x' }]), /valid time zone/);
    data = await command('editEvent', [1, { n: 'Impact', b: tomorrow, d: 2, tz: 'America/Los_Angeles' }]);
    assert.equal(data.events[0].tz, 'America/Los_Angeles');
    let reminder = (await outbox("kind = 'reminder' and status = 'pending'"))[0];
    const duePacific = await one(`select ($1::date + interval '9 hours 30 minutes') at time zone 'America/Los_Angeles' as t`, [tomorrow]);
    assert.equal(reminder.due_at.getTime(), duePacific.t.getTime(), 'reminder follows the new time zone');
    data = await command('editEvent', [1, { n: 'Impact 2026', b: tomorrow, d: 2 }]);
    assert.equal(data.events[0].tz, 'America/Los_Angeles', 'older clients without tz leave it alone');
    data = await command('addEvent', [{ n: 'Later', b: tomorrow, d: 1, tz: 'America/Chicago' }]);
    assert.equal(data.events.find(e => e.name === 'Later').tz, 'America/Chicago');

    // Sender: claims due messages with devices, records results, retries, and forgets gone devices.
    let batch = await claim();
    assert.ok(batch.every(b => b.kind !== 'reminder'), 'reminders are not due yet');
    const changed = batch.find(b => b.payload.title === 'Assignment changed');
    assert.ok(changed, 'immediate pushes are due right away');
    assert.equal(changed.payload.url, '/?asg=1');
    assert.equal(changed.payload.tag, 'asg-1');
    assert.equal(changed.devices.length, 2);
    assert.ok(changed.devices.every(d => d.endpoint && d.p256dh && d.auth));
    assert.deepEqual(await claim(), [], 'claimed messages are not handed out twice');
    const [d1, d2] = changed.devices;
    const first = batch.find(b => b.payload.title === 'New assignment'), testMsg = batch.find(b => b.kind === 'test');
    await report([
      { id: changed.id, devices: [{ id: d1.id, ok: true, status: 201 }, { id: d2.id, ok: false, status: 500, error: 'Server error' }] },
      { id: first.id, devices: [{ id: d1.id, ok: false, status: 503, error: 'Unavailable' }, { id: d2.id, ok: false, status: 429, error: 'Too many requests' }] },
      { id: testMsg.id, devices: [{ id: d1.id, ok: true, status: 201 }, { id: d2.id, ok: true, status: 201 }] }
    ]);
    rows = await outbox(`id in (${changed.id}, ${first.id}, ${testMsg.id})`);
    const statusOf = id => rows.find(r => r.id === id).status;
    assert.deepEqual([statusOf(changed.id), statusOf(first.id), statusOf(testMsg.id)], ['sent', 'pending', 'sent'], 'one device delivering is enough');
    const retry = rows.find(r => r.id === first.id);
    assert.equal(retry.attempts, 1);
    assert.equal(retry.last_error, 'Unavailable');
    assert.ok(retry.next_attempt > new Date(Date.now() + 30000), 'retried about a minute later');
    // Retries stop after four attempts.
    for (let i = 0; i < 3; i++) {
      await makeDue(first.id);
      const again = (await claim()).find(b => b.id === first.id);
      await report([{ id: again.id, devices: [{ id: d1.id, ok: false, error: 'Unavailable' }] }]);
    }
    assert.equal((await outbox(`id = ${first.id}`))[0].status, 'failed');
    assert.equal((await outbox(`id = ${first.id}`))[0].attempts, 4);
    await asUser(admin);
    data = await snapshot();
    assert.equal(data.pushTests[0].st, 'sent');
    assert.ok(data.pushLog.length >= 4 && data.pushLog.every(l => l.err), 'failed deliveries appear in the delivery log');
    assert.ok(data.pushStatus.find(p => p.e === 0).ok, 'last successful delivery is shown');

    // A reminder whose assignment changed after it was queued is skipped, not sent.
    // (The trigger normally deletes it at once; this covers a change racing the sender.)
    await db.query("update public.push_outbox set status = 'sent' where status = 'pending'");
    reminder = await one(`insert into public.push_outbox(person_id, kind, assignment_id, assignment_seq, event_id, title, body, due_at, next_attempt)
      values(0, 'reminder', 1, 0, 1, 'Starts in 30 minutes', 'stale', now() - interval '1 second', now() - interval '1 second') returning id`);
    assert.deepEqual(await claim(), []);
    const stale = (await outbox(`id = ${reminder.id}`))[0];
    assert.deepEqual([stale.status, stale.last_error], ['skipped', 'Assignment changed or removed']);

    // A device the push service reports as gone is removed; with none left the message is skipped.
    await command('pushTest', [0]);
    const gone = (await outbox("kind = 'test' and status = 'pending'"))[0];
    batch = await claim();
    await report([{ id: gone.id, devices: batch[0].devices.map(d => ({ id: d.id, ok: false, gone: true, status: 410, error: 'Gone' })) }]);
    assert.equal((await one('select count(*)::int n from public.push_subscriptions')).n, 0);
    assert.equal((await outbox(`id = ${gone.id}`))[0].status, 'skipped');
    await assert.rejects(command('pushTest', [0]), /hasn't turned on notifications/);

    // Messages for people without devices are skipped when due.
    await asUser(staffUser); await register(sub(3));
    await asUser(admin);
    await command('assign', [1, 1]);
    batch = await claim();
    assert.equal(batch.length, 0, 'Pat has no devices');
    assert.equal((await outbox("person_id = 1 and kind = 'assignment'"))[0].status, 'skipped');

    // Removing an assignment drops its reminder and tells the person; closed events and archived people get nothing.
    await command('addSession', ['Workshop', 'Ballroom', 1, 540, 600, 1, null, 1]);
    await command('assign', [0, 2]);
    const workshopAsg = (await one('select id from public.assignments where person_id = 0 and activity_id = 2')).id;
    assert.equal((await outbox(`assignment_id = ${workshopAsg} and kind = 'reminder' and status = 'pending'`)).length, 1);
    await command('remove', [workshopAsg]);
    assert.equal((await outbox(`assignment_id = ${workshopAsg} and kind = 'reminder' and status = 'pending'`)).length, 0);
    assert.equal((await outbox(`assignment_id = ${workshopAsg} and title = 'Removed from assignment'`)).length, 1);
    await command('setEventClosed', [1, true]);
    const closedCount = (await outbox()).length;
    await command('assign', [0, 2]);
    assert.equal((await outbox()).length, closedCount, 'closed events queue nothing');
    const pending = await outbox("status = 'pending'");
    for (const r of pending) await makeDue(r.id);
    assert.deepEqual(await claim(), [], 'queued messages for a closed event are skipped');
    await command('setEventClosed', [1, false]);
    assert.equal((await outbox("kind = 'reminder' and status = 'pending'")).length, 3, 'reopening restores reminders for all three assignments');

    // Deleting an activity sends one cancellation per person, not a removal as well.
    const mark = (await one('select max(id)::int m from public.push_outbox')).m;
    await command('delSession', [2]);
    rows = await outbox(`id > ${mark}`);
    assert.deepEqual(rows.map(r => [r.person_id, r.title]), [[0, 'Activity cancelled']]);
    assert.equal((await outbox("kind = 'reminder' and status = 'pending' and assignment_id not in (select id from public.assignments)")).length, 0);

    // Late assignment: under 30 minutes before start gets only the immediate push.
    if (nowMin + 10 < 1430) {
      await command('editEvent', [2, { n: 'Later', b: today, d: 1, tz: 'America/New_York' }]);
      await command('addSession', ['Pop-up', 'Ballroom', 0, nowMin + 10, nowMin + 40, 1, null, 2]);
      const late = (await one("select id from public.activities where title = 'Pop-up'")).id;
      await command('assign', [0, late]);
      const lateAsg = (await one('select id from public.assignments where activity_id = $1', [late])).id;
      assert.deepEqual((await outbox(`assignment_id = ${lateAsg}`)).map(r => r.kind), ['assignment']);
    }

    // Deleting an event notifies its assigned people once; archiving a person stops their pushes.
    const mark2 = (await one('select max(id)::int m from public.push_outbox')).m;
    await command('delEvent', [1]);
    rows = await outbox(`id > ${mark2}`);
    assert.deepEqual(rows.map(r => [r.person_id, r.title, r.body]), [[0, 'Event removed', 'Impact 2026'], [1, 'Event removed', 'Impact 2026']]);
    await command('delStaff', [0]);
    for (const r of await outbox("status = 'pending'")) await makeDue(r.id);
    await claim();
    assert.equal((await outbox("status = 'pending' and person_id = 0")).length, 0, 'archived people are skipped');
  } finally { await db.close(); }
});
