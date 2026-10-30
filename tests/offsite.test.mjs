import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002', patUser = '00000000-0000-0000-0000-000000000003';

test('offsite check-out: staff leave and return, monitors are told and acknowledge, admins see the log', async () => {
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
    const notes = async e => (await db.query('select message, done, offsite_kind from public.notifications where person_id = $1 and offsite_id is not null order by id', [e])).rows;
    const pushes = async () => (await db.query("select person_id, title from public.push_outbox where kind = 'notice' order by id")).rows;

    for (const [n, acct] of [['Alex Rivera', 'staff'], ['Pat Quinn', 'contractor'], ['Bre Binder', 'admin'], ['Erin Washburn', 'admin']])
      await command('addStaff', [{ n, r: 'Ops', acct, phone: '', map: true }]);
    // Event with Bre (2) as the only monitor; a staff person can't be a monitor.
    let data = await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 9, tz: 'America/Puerto_Rico', mon: [2, 0] }]);
    assert.equal(data.offsiteSupport, true);
    assert.deepEqual(data.monitors, [{ ev: 1, e: 2, c: false }]);
    assert.equal(data.events[0].name, 'IMPACT26');
    await db.exec(`insert into public.push_subscriptions(person_id, endpoint, p256dh, auth) values(2, 'https://fcm.googleapis.com/fcm/send/x', '${'k'.repeat(30)}', 'authauth1')`);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${alexUser}','alex@example.test'),('${patUser}','pat@example.test');`);

    // Event Staff can't use it.
    await as(patUser);
    await assert.rejects(command('goOffsite', [1, 'Pharmacy']), /for Staff and Admins/);
    // Alex leaves: reason required, then a notice and push to Bre only.
    await as(alexUser);
    await assert.rejects(command('goOffsite', [1, '  ']), /reason/);
    data = await command('goOffsite', [1, 'Pharmacy run']);
    assert.deepEqual(data.away.map(a => a.e), [0]);
    await assert.rejects(command('goOffsite', [1, 'Again']), /already checked out/);
    assert.match((await notes(2))[0].message, /^Offsite: Alex Rivera left at \d{1,2}:\d{2} [AP]M\. Reason: Pharmacy run$/);
    assert.deepEqual(await notes(3), [], 'Erin is not a monitor');
    assert.deepEqual((await pushes()).map(p => [p.person_id, p.title]), [[2, 'Offsite: Alex Rivera']]);
    // Alex sees only his own record.
    assert.equal((await snapshot()).offsite.length, 1);
    await assert.rejects(command('ackOffsite', [1]), /Administrator/);

    // Admin acknowledges leaving; the notice is done.
    await as(admin);
    data = await snapshot();
    const note = data.notes.find(n => n.oid === 1 && n.ok === 'out');
    assert.ok(note && note.e === 2);
    data = await command('ackOffsite', [1]);
    let row = data.offsite[0];
    assert.equal(row.oa, 'admin@example.test'); assert.ok(row.oat);
    assert.equal((await notes(2))[0].done, true);

    // Alex returns; Bre is told; acknowledged.
    await as(alexUser);
    data = await command('goOnsite', ['Back by the lobby']);
    assert.deepEqual(data.away, []);
    await assert.rejects(command('goOnsite', ['']), /not checked out/);
    assert.match((await notes(2))[1].message, /^Back onsite: Alex Rivera returned at .*Note: Back by the lobby$/);
    await as(admin);
    row = (await snapshot()).offsite[0];
    assert.ok(row.back && row.oa && !('ba' in row));
    assert.equal(row.why, 'Pharmacy run');
    assert.equal((await notes(2))[1].done, false, 'the return notice is information only (dismissed with Got it)');

    // Every event needs a monitor; an event set up before monitors existed (none) tells every admin.
    await assert.rejects(command('editEvent', [1, { n: 'IMPACT26', b: '2026-11-05', d: 9, mon: [] }]), /at least one admin/);
    await db.exec('delete from public.event_monitors');
    await as(alexUser);
    await command('goOffsite', [1, 'Dinner in town']);
    assert.equal((await notes(3)).length, 1, 'Erin is told when no monitors are set');
    assert.equal((await notes(2)).length, 3);
  } finally { await db.close(); }
});
