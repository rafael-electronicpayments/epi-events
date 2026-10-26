import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const flight = { inCarrier: 'JetBlue Airways', inFlight: 'B6 1751', inFrom: 'JFK', inTo: 'SJU', inArrive: '2026-11-06T18:40',
  outCarrier: 'JetBlue Airways', outFlight: 'B6 1004', outFrom: 'SJU', outTo: 'JFK', outDepart: '2026-11-12T16:10', paid: 'corporate_amex', cost: '0', bags: '0' };
const hotel = { name: 'Wyndham Rio Mar', conf: 'H-1', in: '2026-11-06', out: '2026-11-12', paid: 'event', byEvent: true, tIn: 'own', tOut: 'shuttle', tNotes: 'Main entrance, bell stand' };

test('departure pickup time follows the flight, can be set by admins, and queues a 30-minute reminder; travel instructions', async () => {
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
    const outbox = async () => (await db.query("select status, title, body, due_at, noted, last_error from public.push_outbox where kind = 'pickup' order by id")).rows;
    const notes = async () => (await db.query('select message from public.notifications where person_id = 0 order by id')).rows.map(r => r.message);

    await asUser(admin);
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, tz: 'America/Puerto_Rico', venue: 'Wyndham Rio Mar' }]);
    await command('addStaff', [{ n: 'Alex Rivera', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${alexUser}','alex@example.test');`);

    // Shuttle: 3 hours before a domestic flight, rounded down to the hour; reminder 30 minutes before (Puerto Rico is UTC-4).
    let data = await command('saveFlight', [1, 0, flight]);
    assert.equal(data.travelInfo, true);
    assert.equal(data.flights[0].intl, false);
    data = await command('saveHotel', [1, 0, hotel]);
    assert.deepEqual([data.hotels[0].pickup, data.hotels[0].pickupManual], ['2026-11-12T13:00', false]);
    let ob = await outbox();
    assert.equal(ob.length, 1);
    assert.equal(ob[0].title, 'Shuttle leaves in 30 minutes');
    assert.equal(new Date(ob[0].due_at).toISOString(), '2026-11-12T16:30:00.000Z');
    assert.match(ob[0].body, /^Pickup 1:00 PM at Wyndham Rio Mar\. Flight B6 1004 departs 4:10 PM\. Main entrance, bell stand$/);
    assert.ok((await notes()).some(m => /shuttle pickup for Impact 2026 is Thu, Nov 12, 1:00 PM/.test(m)));

    // International: 4 hours. A changed flight moves the automatic pickup.
    data = await command('saveFlight', [1, 0, { ...flight, intl: true }]);
    assert.equal(data.flights[0].intl, true);
    assert.equal(data.hotels[0].pickup, '2026-11-12T12:00');
    data = await command('saveFlight', [1, 0, { ...flight, intl: true, outDepart: '2026-11-12T18:12' }]);
    assert.equal(data.hotels[0].pickup, '2026-11-12T14:00');
    assert.equal((await outbox()).filter(r => r.status === 'pending').length, 1, 'one pending reminder per person');

    // An admin's own time stays until reset, even when the flight changes.
    await assert.rejects(command('saveHotel', [1, 0, { ...hotel, pickupManual: true, pickup: '' }]), /Enter the pickup date and time/);
    data = await command('saveHotel', [1, 0, { ...hotel, pickupManual: true, pickup: '2026-11-12T11:30' }]);
    assert.deepEqual([data.hotels[0].pickup, data.hotels[0].pickupManual], ['2026-11-12T11:30', true]);
    data = await command('saveFlight', [1, 0, { ...flight, intl: true, outDepart: '2026-11-12T20:00' }]);
    assert.equal(data.hotels[0].pickup, '2026-11-12T11:30');
    data = await command('saveHotel', [1, 0, { ...hotel, pickupManual: false }]);
    assert.deepEqual([data.hotels[0].pickup, data.hotels[0].pickupManual], ['2026-11-12T16:00', false]);
    // Older clients that don't send the pickup fields leave it alone.
    data = await command('saveHotel', [1, 0, { ...hotel, conf: 'H-2' }]);
    assert.equal(data.hotels[0].pickup, '2026-11-12T16:00');

    // Instructions: admins edit; people see only the ways their transfer is a car or shuttle.
    await command('setTravelInfo', [1, { arr: '<p><b>Arrivals</b> meet the greeter.</p>', dep: '<p>Pickup at the <u>main entrance</u>.</p>' }]);
    data = await snapshot();
    assert.deepEqual([data.events[0].arrInfo, data.events[0].depInfo], ['<p><b>Arrivals</b> meet the greeter.</p>', '<p>Pickup at the <u>main entrance</u>.</p>']);
    await asUser(alexUser);
    data = await snapshot();
    assert.deepEqual([data.events[0].arrInfo, data.events[0].depInfo, data.hotels[0].pickup], ['', '<p>Pickup at the <u>main entrance</u>.</p>', '2026-11-12T16:00']);
    await assert.rejects(command('setTravelInfo', [1, { arr: 'x', dep: 'y' }]), /Administrator access required/);
    await asUser(admin);
    await assert.rejects(command('setTravelInfo', [1, { arr: 'x'.repeat(20001), dep: '' }]), /too long/);

    // When the reminder comes due: in-app notice once (even with no devices), and no push without devices.
    await db.exec("update public.push_outbox set due_at = now() - interval '1 minute', next_attempt = now() - interval '1 minute' where kind = 'pickup' and status = 'pending'");
    await db.query('select public.push_claim(50)');
    await db.query('select public.push_claim(50)');
    const due = (await notes()).filter(m => m.startsWith('Shuttle leaves in 30 minutes. Pickup 4:00 PM'));
    assert.equal(due.length, 1);
    ob = await outbox();
    assert.deepEqual([ob.at(-1).status, ob.at(-1).noted], ['skipped', true]);

    // Too late (pickup already passed): dropped without a notice.
    await command('saveHotel', [1, 0, { ...hotel, conf: 'H-3', pickupManual: true, pickup: '2026-11-12T15:00' }]);
    await db.exec("update public.push_outbox set due_at = now() - interval '31 minutes', next_attempt = now() - interval '31 minutes' where kind = 'pickup' and status = 'pending'");
    await db.query('select public.push_claim(50)');
    ob = await outbox();
    assert.deepEqual([ob.at(-1).status, ob.at(-1).last_error, ob.at(-1).noted], ['skipped', 'Too late: the pickup time has passed', false]);

    // Own arrangement: no pickup, no reminder, no Departure card for the traveler.
    data = await command('saveHotel', [1, 0, { ...hotel, tOut: 'own' }]);
    assert.equal(data.hotels[0].pickup, null);
    assert.equal((await outbox()).filter(r => r.status === 'pending').length, 0);
    await asUser(alexUser);
    assert.equal((await snapshot()).events[0].depInfo, '');
  } finally { await db.close(); }
});
