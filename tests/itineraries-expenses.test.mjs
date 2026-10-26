import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const flight = { inCarrier: 'JetBlue Airways', inFlight: 'B6 1234', inFrom: 'BOS', inTo: 'SJU', inArrive: '2026-11-06T14:35',
  outCarrier: 'JetBlue Airways', outFlight: 'B6 1235', outFrom: 'SJU', outTo: 'BOS', outDepart: '2026-11-12T16:10', paid: 'personal_card', ref: 'ABC123', cost: '412.30', bags: '35' };
const hotel = { conf: 'H-1', in: '2026-11-06', out: '2026-11-12', paid: 'personal_card', total: '1981.44' };

test('itinerary bookings add the traveler\'s expenses with receipts, and approval locks the costs', async () => {
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
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, venue: 'El Conquistador', staffFlights: true, staffHotels: true }]);
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex Rivera', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 1, null, 1]);
    await command('assign', [0, 1]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${alexUser}','alex@example.test');`);

    await asUser(alexUser);
    // A receipt is required to add expenses.
    await assert.rejects(command('saveFlight', [1, 0, { ...flight, addExpense: true, reimb: true }]), /Attach a photo or PDF of the receipt/);
    let data = await command('saveFlight', [1, 0, { ...flight, addExpense: true, reimb: true, rp: '0/air-1.jpg', rt: 'image/jpeg', rp2: '0/bag-1.jpg' }]);
    assert.equal(data.travelExpenses, true);
    let f = data.flights[0];
    const air = data.expenses.find(x => x.id === f.exp), bag = data.expenses.find(x => x.id === f.bagExp);
    assert.deepEqual([air.cat, Number(air.amt), air.pay, air.reimb, air.loc, air.ref, air.rp], ['airfare', 412.3, 'personal_card', true, 'JetBlue Airways', 'ABC123', '0/air-1.jpg']);
    assert.match(air.notes, /B6 1234 BOS→SJU/);
    assert.deepEqual([bag.cat, Number(bag.amt), bag.rp], ['baggage', 35, '0/bag-1.jpg']);
    assert.equal(f.addExp, true);

    // Editing the booking updates its expenses (no new receipt needed); linked expenses can't be edited directly.
    data = await command('saveFlight', [1, 0, { ...flight, cost: '450', bags: '0', addExpense: true, reimb: true }]);
    f = data.flights[0];
    assert.equal(Number(data.expenses.find(x => x.id === f.exp).amt), 450);
    assert.equal(f.bagExp, null, 'bag fee removed, its expense removed');
    assert.equal(data.expenses.length, 1);
    await assert.rejects(command('editExpense', [f.exp, { cat: 'airfare', loc: 'X', ref: '', date: '2026-11-01', amt: '1', pay: 'cash', reimb: false, notes: '', rp: '0/air-1.jpg', rt: 'image/jpeg' }]), /comes from your itinerary/);
    await assert.rejects(command('delExpense', [f.exp]), /comes from your itinerary/);

    // Points ticket: no airfare expense, but a bag fee can still be claimed; points with no bag fee has nothing to add.
    data = await command('saveFlight', [1, 0, { ...flight, paid: 'points', cost: '0', bags: '35', addExpense: true, reimb: true, rp: '0/bag-2.jpg', rt: 'image/jpeg' }]);
    f = data.flights[0];
    assert.equal(f.exp, null, 'airfare expense removed for a points ticket');
    assert.deepEqual([data.expenses.find(x => x.id === f.bagExp).cat, Number(data.expenses.find(x => x.id === f.bagExp).amt)], ['baggage', 35]);
    await assert.rejects(command('saveFlight', [1, 0, { ...flight, paid: 'points', cost: '0', bags: '0', addExpense: true }]), /paid with points and has no bag fee/);

    // Hotel paid by card: Hotel expense for the folio total; Event-billed: nothing to add.
    await assert.rejects(command('saveHotel', [1, 0, { ...hotel, paid: 'event', addExpense: true, rp: '0/h-1.jpg', rt: 'image/jpeg' }]), /master bill/);
    data = await command('saveHotel', [1, 0, { ...hotel, addExpense: true, reimb: true, rp: '0/h-1.jpg', rt: 'application/pdf' }]);
    let h = data.hotels[0], hx = data.expenses.find(x => x.id === h.exp);
    assert.deepEqual([hx.cat, Number(hx.amt), hx.loc, hx.rt], ['hotel', 1981.44, 'El Conquistador', 'application/pdf']);
    assert.match(hx.notes, /6 nights\), confirmation H-1/);

    // Approval locks costs for the traveler; details can still change; admins can change costs (sent back for approval).
    await asUser(admin);
    await command('approveExpense', [h.exp, true]);
    await asUser(alexUser);
    await assert.rejects(command('saveHotel', [1, 0, { ...hotel, total: '2000', addExpense: true, reimb: true }]), /costs are locked/);
    await assert.rejects(command('delHotel', [h.id]), /approved, so it can't be deleted/);
    data = await command('saveHotel', [1, 0, { ...hotel, conf: 'H-2', addExpense: true, reimb: true }]);
    assert.equal(data.hotels[0].conf, 'H-2', 'non-cost details still editable');
    assert.equal(data.expenses.find(x => x.id === h.exp).ok, true, 'still approved');
    await asUser(admin);
    data = await command('saveHotel', [1, 0, { ...hotel, conf: 'H-2', total: '2000', addExpense: true, reimb: true }]);
    hx = data.expenses.find(x => x.id === data.hotels[0].exp);
    assert.deepEqual([Number(hx.amt), hx.ok], [2000, false], 'admin change to an approved amount needs approval again');

    // Turning off Add to expenses removes the expense; deleting a booking removes its expenses.
    data = await command('saveHotel', [1, 0, { ...hotel, addExpense: false }]);
    assert.equal(data.hotels[0].exp, null);
    assert.ok(!data.expenses.some(x => x.cat === 'hotel'));
    data = await command('delFlight', [data.flights[0].id]);
    assert.equal(data.expenses.length, 0);
    // Ordinary expenses still work, with the new types available.
    await asUser(alexUser);
    data = await command('addExpense', [1, { cat: 'transportation', loc: 'Uber', ref: '', date: '2026-11-06', amt: '38.20', pay: 'personal_card', reimb: true, notes: 'Airport to hotel', rp: '0/uber-1.jpg', rt: 'image/jpeg' }]);
    assert.equal(data.expenses[0].cat, 'transportation');
  } finally { await db.close(); }
});
