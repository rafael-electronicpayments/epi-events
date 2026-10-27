import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';

test('flight manifest import adds and updates flights, keeps costs, and sets car service for VIP rows', async () => {
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
    const fOf = (d, e) => d.flights.find(f => f.e === e), hOf = (d, e) => d.hotels.find(h => h.e === e);
    const notes = async e => (await db.query('select message from public.notifications where person_id = $1 order by id', [e])).rows.map(r => r.message);

    await asUser(admin);
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, tz: 'America/Puerto_Rico' }]);
    for (const n of ['Alex Rivera', 'Sam Lee', 'Jordan Park']) await command('addStaff', [{ n, r: 'Host', acct: 'staff', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${alexUser}','alex@example.test');`);
    let data = await snapshot();
    assert.equal(data.flightImport, true);
    // Sam already has a flight with a cost; Jordan has a hotel (for the VIP car service).
    await command('saveFlight', [1, 1, { inCarrier: 'Delta Air Lines', inFlight: 'DL 1', inArrive: '2026-11-06T10:00', paid: 'corporate_amex', cost: '400', bags: '0' }]);
    await command('saveHotel', [1, 2, { in: '2026-11-06', out: '2026-11-12', paid: 'event', tIn: 'shuttle', tOut: 'shuttle' }]);

    const rows = [
      { e: 0, inCarrier: 'United Airlines', inFlight: 'UA 1889 & UA 1339', inArrive: '2026-11-06T18:25', outCarrier: 'United Airlines', outFlight: 'UA 1368 & UA 2132', outDepart: '2026-11-12T14:21', intl: false },
      { e: 1, inCarrier: 'Iberia', inFlight: 'IB 381', inArrive: '2026-11-06T16:40', outCarrier: 'Iberia', outFlight: 'IB 382', outDepart: '2026-11-13T18:12', intl: true },
      { e: 2, inCarrier: 'Delta Air Lines', inFlight: 'DL 446', inArrive: '2026-11-08T16:56', outCarrier: 'Delta Air Lines', outFlight: 'DL 1877', outDepart: '2026-11-12T14:05', intl: false, vip: true }];
    data = await command('importFlights', [1, rows]);
    const a = fOf(data, 0), s = fOf(data, 1), j = fOf(data, 2);
    assert.deepEqual([a.inFlight, a.outFlight, a.by, a.byEvent, a.paid], ['UA 1889 & UA 1339', 'UA 1368 & UA 2132', 0, false, 'personal_card']);
    assert.deepEqual([s.inFlight, s.outDepart, s.intl, Number(s.cost), s.paid], ['IB 381', '2026-11-13T18:12', true, 400, 'corporate_amex'], 'costs and payment kept on update');
    const jh = hOf(data, 2);
    assert.deepEqual([jh.tIn, jh.tOut, jh.pickup], ['car', 'car', '2026-11-12T11:00'], 'VIP: car service both ways; pickup from the new flight');
    assert.ok((await notes(0)).some(m => /flight for Impact 2026 has been added/.test(m)));
    assert.ok((await notes(1)).some(m => /flight for Impact 2026 was updated/.test(m)));

    // Re-import of the same rows changes nothing and sends no new notices.
    const before = (await notes(0)).length;
    await command('importFlights', [1, rows]);
    assert.equal((await notes(0)).length, before);

    // Bad rows are refused; only admins import.
    await assert.rejects(command('importFlights', [1, [{ e: 0, inArrive: '2026-11-08T10:00', outDepart: '2026-11-07T10:00' }]]), /departure must be after/);
    await assert.rejects(command('importFlights', [1, [{ e: 0 }]]), /arrival or departure time/);
    await assert.rejects(command('importFlights', [1, [{ e: 0, inFlight: 'X'.repeat(61), inArrive: '2026-11-08T10:00' }]]), /too long/);
    await asUser(alexUser);
    await assert.rejects(command('importFlights', [1, rows]), /Administrator access required/);
  } finally { await db.close(); }
});
