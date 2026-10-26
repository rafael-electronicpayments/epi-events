import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Fictional people only.
const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const hotel = { conf: '1000001', in: '2026-11-07', out: '2026-11-12', paid: 'personal_card', total: '1500', tIn: 'own', tOut: 'shuttle' };

test('accompanying person shares the reservation; rooming list import adds, updates, links, and removes', async () => {
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
    const hOf = (data, e) => data.hotels.find(h => h.e === e);
    const notes = async e => (await db.query('select message from public.notifications where person_id = $1 order by id', [e])).rows.map(r => r.message);

    await asUser(admin);
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, venue: 'Seaside Resort' }]);
    for (const n of ['Alex Rivera', 'Sam Lee', 'Jordan Park', 'Casey Moore']) await command('addStaff', [{ n, r: 'Host', acct: 'staff', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${alexUser}','alex@example.test');`);

    // Link Sam to Alex's booking: Sam gets a shared copy without costs; each names the other.
    let data = await command('saveHotel', [1, 0, { ...hotel, companion: 'Sam Lee', companionId: 1 }]);
    assert.equal(data.companions, true);
    let a = hOf(data, 0), s = hOf(data, 1);
    assert.deepEqual([a.companion, a.companionId, a.primary, Number(a.total)], ['Sam Lee', 1, true, 1500]);
    assert.deepEqual([s.companion, s.companionId, s.primary, s.conf, s.in, s.out, s.name, Number(s.total), s.tOut],
      ['Alex Rivera', 0, false, '1000001', '2026-11-07', '2026-11-12', 'Seaside Resort', 0, 'own']);
    assert.ok((await notes(1)).some(m => /sharing with Alex Rivera/.test(m)));

    // Editing the copy's dates updates both; costs and expenses on the copy are ignored.
    data = await command('saveHotel', [1, 1, { ...hotel, out: '2026-11-13', total: '999', addExpense: true, rp: '1/x.jpg', rt: 'image/jpeg', tOut: 'car' }]);
    a = hOf(data, 0); s = hOf(data, 1);
    assert.deepEqual([a.out, s.out, Number(s.total), s.exp ?? null, s.tOut, a.tOut], ['2026-11-13', '2026-11-13', 0, null, 'car', 'shuttle']);
    assert.equal(data.expenses.length, 0);
    assert.ok((await notes(0)).some(m => /shared hotel booking for Impact 2026 was updated/.test(m)));
    // Editing the primary updates the copy.
    data = await command('saveHotel', [1, 0, { ...hotel, conf: '1000002', out: '2026-11-13', companion: 'Sam Lee', companionId: 1 }]);
    assert.equal(hOf(data, 1).conf, '1000002');

    // The traveler sees the accompanying name on their booking.
    await asUser(alexUser);
    assert.equal(hOf(await snapshot(), 0).companion, 'Sam Lee');
    await asUser(admin);

    // Switching to someone not on the roster: Sam's copy is removed, the name is kept as text.
    data = await command('saveHotel', [1, 0, { ...hotel, companion: 'Pat Guest', companionId: null }]);
    assert.equal(hOf(data, 1), undefined);
    assert.deepEqual([hOf(data, 0).companion, hOf(data, 0).companionId], ['Pat Guest', null]);
    assert.ok((await notes(1)).some(m => /shared hotel booking for Impact 2026 was removed/.test(m)));

    // Linking someone who has their own booking turns it into the shared copy (their costs cleared).
    await command('saveHotel', [1, 2, { ...hotel, conf: '2000001', total: '800', paid: 'corporate_amex' }]);
    data = await command('saveHotel', [1, 0, { ...hotel, companionId: 2 }]);
    const j = hOf(data, 2);
    assert.deepEqual([j.primary, Number(j.total), j.conf, j.companion], [false, 0, '1000001', 'Alex Rivera']);
    // Deleting the primary removes the copy too.
    data = await command('delHotel', [hOf(data, 0).id]);
    assert.equal(data.hotels.length, 0);

    // Rooming list import: new bookings with venue/Event defaults, a linked companion, a text-only companion.
    data = await command('importHotels', [1, [
      { e: 0, conf: '5615312', in: '2026-11-07', out: '2026-11-12', companion: 'Lee, Sam', companionId: 1 },
      { e: 2, conf: '5615298', in: '2026-11-05', out: '2026-11-14', companion: 'Guest, Robin', companionId: null }], []]);
    a = hOf(data, 0); s = hOf(data, 1); const p = hOf(data, 2);
    assert.deepEqual([a.conf, a.name, a.paid, a.byEvent, a.companion, s.primary, s.conf], ['5615312', 'Seaside Resort', 'event', true, 'Sam Lee', false, '5615312']);
    assert.deepEqual([p.companion, p.companionId, p.in, p.out], ['Guest, Robin', null, '2026-11-05', '2026-11-14']);
    assert.ok((await notes(2)).some(m => /has been booked: confirmation 5615298, Thu, Nov 5 – Sat, Nov 14/.test(m)));

    // Re-import: changed dates update (transfers kept), unchanged rows are left alone, a cancelled row is removed.
    await command('saveHotel', [1, 0, { ...hotel, conf: '5615312', tOut: 'car', companionId: 1, companion: 'Sam Lee' }]);
    const before = (await notes(0)).length;
    data = await command('importHotels', [1, [{ e: 0, conf: '5615312', in: '2026-11-08', out: '2026-11-12', companion: 'Lee, Sam', companionId: 1 }], [2]]);
    a = hOf(data, 0);
    assert.deepEqual([a.in, a.tOut, hOf(data, 1).in, hOf(data, 2)], ['2026-11-08', 'car', '2026-11-08', undefined]);
    assert.equal((await notes(0)).length, before + 1);
    data = await command('importHotels', [1, [{ e: 0, conf: '5615312', in: '2026-11-08', out: '2026-11-12', companion: 'Lee, Sam', companionId: 1 }], []]);
    assert.equal((await notes(0)).length, before + 1, 'no notice when nothing changed');

    // Only admins import; bad rows are refused.
    await assert.rejects(command('importHotels', [1, [{ e: 3, conf: '1', in: '2026-11-08', out: '2026-11-07' }], []]), /departure date must be after/);
    await asUser(alexUser);
    await assert.rejects(command('importHotels', [1, [], []]), /Administrator access required/);
    // A traveler can type an accompanying name on a booking they entered, but not link someone.
    await asUser(admin);
    await command('editEvent', [1, { n: 'Impact 2026', b: '2026-11-07', d: 6, staffHotels: true }]);
    await command('delHotel', [hOf(await snapshot(), 0).id]);
    await asUser(alexUser);
    data = await command('saveHotel', [1, 0, { ...hotel, companion: 'Casey Moore', companionId: 3 }]);
    assert.deepEqual([hOf(data, 0).companion, hOf(data, 0).companionId, hOf(data, 3)], ['Casey Moore', null, undefined]);
  } finally { await db.close(); }
});
