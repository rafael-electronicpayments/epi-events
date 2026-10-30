import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { locatorRows, locatorFilter } from '../src/locator.js';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002', patUser = '00000000-0000-0000-0000-000000000003';

test('locator rows and search', () => {
  const people = [{ id: 0, name: 'Amber Josi', role: 'Marketing' }, { id: 1, name: 'Matt Findlan', role: 'Ops', gone: true }];
  const activities = [{ id: 5, ev: 1, t: 'Registration', r: 'Lobby', d: 0, a: 480, b: 600 }];
  const S = { asg: [{ id: 1, e: 0, s: 5 }, { id: 2, e: 1, s: 5 }] };
  const rows = locatorRows(S, { admin: true, people, activities, ev: 1 });
  assert.deepEqual(rows.map(x => [x.n, x.tm, x.r]), [['Amber Josi', 'Marketing', 'Lobby']]);
  assert.equal(locatorFilter(rows, 'marketing').length, 1);
  assert.equal(locatorFilter(rows, 'amb jos').length, 1);
  assert.equal(locatorFilter(rows, 'keynote').length, 0);
  assert.deepEqual(locatorRows({ locator: [{ ev: 2 }] }, { admin: false, people, activities, ev: 1 }), []);
});

test('offsite contact, staff locator access, acknowledge all and got it all', async () => {
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

    for (const [n, acct, phone] of [['Alex Rivera', 'staff', ''], ['Pat Quinn', 'contractor', ''], ['Amber Josi', 'admin', '787-555-0101'], ['Bre Binder', 'admin', '']])
      await command('addStaff', [{ n, r: n === 'Pat Quinn' ? 'Marketing' : 'Ops', acct, phone, map: true }]);
    // Contact: one of the monitors; a non-monitor contact is ignored.
    let data = await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [2, 3], monc: 2 }]);
    assert.equal(data.locatorSupport, true);
    assert.deepEqual(data.monitors, [{ ev: 1, e: 2, c: true }, { ev: 1, e: 3, c: false }]);
    assert.deepEqual(data.offsiteContact, [{ ev: 1, e: 2, n: 'Amber Josi', ph: '787-555-0101' }]);
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [2, 3], monc: 3 }]);
    assert.deepEqual(data.offsiteContact.map(x => x.n), ['Bre Binder']);
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [2], monc: 3 }]);
    assert.deepEqual(data.offsiteContact, [], 'contact must be a monitor');
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [2, 3], monc: 2 }]);
    data = await command('editEvent', [1, { n: 'IMPACT26 ', b: '2026-11-05', d: 3, mon: [2, 3] }]);
    assert.deepEqual(data.offsiteContact.map(x => x.n), ['Amber Josi'], 'no monc leaves the contact as it was');
    data = await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [2, 3], monc: null }]);
    assert.deepEqual(data.offsiteContact, []);
    await command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [2, 3], monc: 2 }]);

    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${alexUser}','alex@example.test'),('${patUser}','pat@example.test');`);
    await command('addRoom', ['Lobby']);
    await command('addSession', ['Registration', 'Lobby', 0, 480, 600, 1, null, 1, { det: 'Secret details', nt: 'Admin note', by: '' }]);
    await command('addSession', ['Keynote doors', 'Lobby', 0, 600, 660, 1, null, 1, { det: '', nt: '', by: '' }]);
    const acts = (await snapshot()).activities;
    for (const s of acts) { await command('assign', [0, s.id]); await command('assign', [1, s.id]); }
    await command('sendReminder', [1, [0], 'Report to the desk']);
    await command('sendReminder', [1, [0], 'Bring your badge']);

    // Staff see the contact (with phone) but no locator yet.
    await as(alexUser);
    data = await snapshot();
    assert.deepEqual(data.offsiteContact, [{ ev: 1, e: 2, n: 'Amber Josi', ph: '787-555-0101' }]);
    assert.deepEqual([data.locator, data.locViewers, data.monitors], [[], [], []]);
    await assert.rejects(command('setLocatorViewers', [1, [0]]), /Administrator/);

    // Locator access per event for Pat (Event Staff): every assignment, without details.
    await as(admin);
    data = await command('setLocatorViewers', [1, [1, 2]]);
    assert.deepEqual(data.locViewers, [{ ev: 1, e: 1 }], 'admins are left out; they always see it');
    assert.equal(data.locator.length, 0, 'admins use the schedule');
    await as(patUser);
    data = await snapshot();
    assert.equal(data.locator.length, 4);
    assert.deepEqual(Object.keys(data.locator[0]).sort(), ['a', 'b', 'd', 'e', 'ev', 'id', 'n', 'r', 't', 'tm']);
    assert.ok(data.locator.some(x => x.n === 'Alex Rivera' && x.r === 'Lobby' && x.t === 'Registration' && x.tm === 'Ops'));
    assert.ok(!JSON.stringify(data.locator).includes('Secret'), 'no activity details');
    assert.equal((await db.query("select count(*)::int n from public.notifications where person_id = 1 and message like 'You can now see where staff%'")).rows[0].n, 1);

    // Acknowledge all: two assignments + two messages for Alex in one command; a bad id is skipped.
    await as(alexUser);
    data = await snapshot();
    const open = data.notes.filter(n => n.e === 0 && !n.done);
    const a = open.filter(n => n.aid).map(n => n.aid), r = open.filter(n => n.rid).map(n => n.rid);
    assert.deepEqual([a.length, r.length], [2, 2]);
    data = await command('ackAll', [{ a: [...a, 9999], r, o: [] }]);
    assert.ok(data.asg.filter(x => x.e === 0).every(x => x.ack === 1));
    assert.equal(data.notes.filter(n => n.e === 0 && !n.done && (n.aid || n.rid)).length, 0);
    assert.equal((await db.query("select count(*)::int n from public.reminder_recipients where person_id = 0 and acked_at is not null")).rows[0].n, 2);
    // Someone else's assignment can't be acknowledged this way.
    await as(patUser);
    data = await snapshot();
    const alexAsg = (await db.query('select id from public.assignments where person_id = 0')).rows.map(x => x.id);
    await command('ackAll', [{ a: alexAsg }]);
    // Got it all: Pat's plain notices.
    const got = data.notes.filter(n => n.e === 1 && !n.done && !n.aid && !n.rid).map(n => n.id);
    assert.ok(got.length >= 1);
    data = await command('dismissAll', [[...got]]);
    assert.equal(data.notes.filter(n => got.includes(n.id) && !n.done).length, 0);
    // Only your own notices.
    const alexNote = (await db.query("insert into public.notifications(person_id, message) values(0, 'For Alex') returning id")).rows[0].id;
    await command('dismissAll', [[alexNote]]);
    assert.equal((await db.query('select done from public.notifications where id = $1', [alexNote])).rows[0].done, false);
    await assert.rejects(db.query('select public.ops_command($1,$2::jsonb,$3)', ['dismissAll', JSON.stringify([[alexNote]]), 0]), e => e.code === 'PT409');
  } finally { await db.close(); }
});
