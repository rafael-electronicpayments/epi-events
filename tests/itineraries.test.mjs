import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const patUser = '00000000-0000-0000-0000-000000000003';

const flight = { inCarrier: 'JetBlue Airways', inFlight: 'b6 1234', inFrom: 'bos', inTo: 'sju', inArrive: '2026-11-06T14:35',
  outCarrier: 'JetBlue Airways', outFlight: 'B6 1235', outFrom: 'SJU', outTo: 'BOS', outDepart: '2026-11-12T16:10',
  paid: 'personal_card', ref: 'ABC123', cost: '412.30', bags: '35' };
const hotel = { conf: 'H-998877', in: '2026-11-06', out: '2026-11-12', byEvent: true, paid: 'event', nightly: '289', charges: '0', total: '1981.44',
  tIn: 'car', tOut: 'shuttle', tNotes: 'Driver meets you at baggage claim, carousel 3.' };

test('itineraries: bookings, per-event switches, who can edit, notices, and privacy', async () => {
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

    await asUser(admin);
    let data = await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, venue: 'El Conquistador Resort', staffFlights: true }]);
    assert.deepEqual([data.events[0].staffFlights, data.events[0].staffHotels, data.itineraries], [true, false, true]);
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex Rivera', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await command('addStaff', [{ n: 'Pat Quinn', r: 'AV', acct: 'contractor', phone: '', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 2, null, 1]);
    for (const p of [0, 1]) await command('assign', [p, 1]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${alexUser}','alex@example.test'),('${patUser}','pat@example.test');`);

    // Admin books Alex's hotel (default hotel name from the venue) with transfers; Alex gets a notice.
    data = await command('saveHotel', [1, 0, { ...hotel }]);
    let h = data.hotels[0];
    assert.deepEqual([h.e, h.name, h.conf, h.in, h.out, Number(h.total), h.tIn, h.tOut, h.byEvent, h.mine],
      [0, 'El Conquistador Resort', 'H-998877', '2026-11-06', '2026-11-12', 1981.44, 'car', 'shuttle', true, true]);
    assert.ok((await db.query("select message from public.notifications where person_id = 0")).rows.some(r => /hotel for Impact 2026 has been booked/.test(r.message)));

    // Alex enters his own flight (allowed), can edit it; can't edit the admin's hotel or enter one (hotels switch off).
    await asUser(alexUser);
    data = await command('saveFlight', [1, 1, flight]);
    let f = data.flights[0];
    assert.deepEqual([f.e, f.inFlight, f.inFrom, f.inTo, f.inArrive, f.outDepart, Number(f.cost), Number(f.bags), f.by, f.mine],
      [0, 'B6 1234', 'BOS', 'SJU', '2026-11-06T14:35', '2026-11-12T16:10', 412.3, 35, 0, true], 'personId ignored for staff; booked by defaults to them');
    data = await command('saveFlight', [1, 0, { ...flight, inFlight: 'B6 1236' }]);
    assert.equal(data.flights[0].inFlight, 'B6 1236');
    await assert.rejects(command('saveHotel', [1, 0, { ...hotel, conf: 'MINE' }]), /turned off for this event/);
    assert.equal(data.hotels[0].tNotes, 'Driver meets you at baggage claim, carousel 3.', 'travelers see their transfer details');
    assert.deepEqual([data.flights.length, data.hotels.length], [1, 1]);
    assert.equal((await db.query("select count(*)::int n from public.notifications where person_id = 0 and message like '%flight%'")).rows[0].n, 0, 'no notice for your own entries');

    // Validation.
    await assert.rejects(command('saveFlight', [1, 0, { ...flight, outDepart: '2026-11-05T09:00' }]), /after the arrival/);
    await assert.rejects(command('saveFlight', [1, 0, { ...flight, cost: '12.345' }]), /Flight cost must be an amount/);
    await assert.rejects(command('saveFlight', [1, 0, { ...flight, inArrive: 'soon' }]), /arrival date and time/);
    await assert.rejects(command('saveFlight', [1, 0, { inCarrier: 'Delta Air Lines' }]), /arriving or departing flight/);
    await assert.rejects(command('saveFlight', [1, 0, { ...flight, inFrom: 'BOST' }]), /check constraint|violates/);

    // Pat (contractor) sees nothing of Alex's; can't touch them.
    await asUser(patUser);
    data = await snapshot();
    assert.deepEqual([data.flights.length, data.hotels.length], [0, 0]);
    assert.deepEqual([await count('flights'), await count('hotels')], [0, 0]);
    await assert.rejects(command('delFlight', [1]), /Access denied/);

    // Admin turns hotels on, staff still can't edit the admin-entered hotel; admin turns flights off: Alex's own flight is locked.
    await asUser(admin);
    data = await command('editEvent', [1, { n: 'Impact 2026', b: '2026-11-07', d: 6, staffFlights: false, staffHotels: true }]);
    assert.deepEqual([data.events[0].staffFlights, data.events[0].staffHotels], [false, true]);
    await asUser(alexUser);
    await assert.rejects(command('saveHotel', [1, 0, { ...hotel, conf: 'MINE' }]), /administrator booked this hotel/);
    await assert.rejects(command('saveFlight', [1, 0, flight]), /turned off for this event/);
    await assert.rejects(command('delFlight', [1]), /turned off for this event/);
    // Staff can't set the transfer: their hotel keeps the admin's choice.
    await asUser(admin);
    await command('delHotel', [1]);
    assert.ok((await db.query("select message from public.notifications where person_id = 0")).rows.some(r => /hotel booking for Impact 2026 was removed/.test(r.message)));
    await asUser(alexUser);
    data = await command('saveHotel', [1, 0, { ...hotel, byEvent: false, paid: 'personal_card', tIn: 'car', tOut: 'car', tNotes: 'VIP' }]);
    h = data.hotels[0];
    assert.deepEqual([h.tIn, h.tOut, h.tNotes, h.mine, h.by], ['own', 'own', '', true, 0], 'transfer is admin-only; defaults to own arrangement');
    await assert.rejects(command('saveHotel', [1, 0, { ...hotel, out: '2026-11-06' }]), /departure date must be after/);
    await asUser(admin);
    data = await command('saveHotel', [1, 0, { ...hotel, byEvent: false, paid: 'personal_card' }]);
    assert.deepEqual([data.hotels[0].tIn, data.hotels[0].tOut], ['car', 'shuttle'], 'admin sets the transfer each way');

    // Closed events hide travel from the traveler and block changes.
    await command('setEventClosed', [1, true]);
    await asUser(alexUser);
    data = await snapshot();
    assert.deepEqual([data.flights.length, data.hotels.length], [0, 0]);
    assert.deepEqual([await count('flights'), await count('hotels')], [0, 0]);
    await asUser(admin);
    data = await snapshot();
    assert.deepEqual([data.flights.length, data.hotels.length], [1, 1], 'admins still see everything');
    // Other commands pass through.
    data = await command('addRoom', ['Salon 1']);
    assert.ok(data.rooms.includes('Salon 1'));
  } finally { await db.close(); }
});
