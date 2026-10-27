import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';

test('run-of-show import creates rooms and activities, assigns teams and leads quietly, and updates on re-import', async () => {
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
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data',
      [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;
    const pushes = async () => (await db.query("select kind, count(*)::int n from public.push_outbox group by kind order by kind")).rows;
    const notes = async e => (await db.query('select message from public.notifications where person_id = $1 order by id', [e])).rows.map(r => r.message);

    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6, tz: 'America/Puerto_Rico' }]);
    await command('addRoom', ['San Cristobal']);
    for (const [n, acct] of [['Alex Rivera', 'staff'], ['Sam Lee', 'admin'], ['Jordan Park', 'contractor'], ['Casey Moore', 'staff']])
      await command('addStaff', [{ n, r: 'Host', acct, phone: '', map: false }]);
    await db.exec(`insert into public.push_subscriptions(person_id, endpoint, p256dh, auth) values(0, 'https://fcm.googleapis.com/fcm/send/x', '${'k'.repeat(30)}', 'authauth1')`);
    let data = await snapshot();
    assert.equal(data.scheduleImport, true);

    const rows = [
      { title: 'Staff Breakfast', room: 'san cristobal', day: 5, start: 510, end: 600, det: '', leads: [1], members: [0, 1, 2, 3], all: true },
      { title: 'POS Lab Pack Up', room: 'Rio Mar Ballrooms 1-4', day: 5, start: 540, end: 840, det: '-Pack all supplies', leads: [0, 2], members: [3] },
      { title: 'Return Shipments', room: 'Wyndham Grand Rio Mar', day: 6, start: 360, end: 1320, det: 'Verify pickup', leads: [1], members: [] }];
    await assert.rejects(command('importSchedule', [1, {}, rows]), /outside the event's days/);
    data = await command('importSchedule', [1, { days: 7 }, rows]);
    assert.equal(data.events[0].days, 7, 'event extended to cover Friday');
    const acts = Object.fromEntries(data.activities.map(a => [a.t, a]));
    assert.deepEqual(Object.keys(acts).sort(), ['POS Lab Pack Up', 'Return Shipments', 'Staff Breakfast']);
    assert.equal(acts['Staff Breakfast'].r, 'San Cristobal', 'existing room matched regardless of case');
    assert.ok(data.rooms.includes('Rio Mar Ballrooms 1-4') && data.rooms.includes('Wyndham Grand Rio Mar'), 'new rooms added');
    const asgOf = t => data.asg.filter(a => a.s === acts[t].id);
    assert.equal(asgOf('Staff Breakfast').length, 4);
    const pack = asgOf('POS Lab Pack Up');
    assert.deepEqual(pack.map(a => [a.e, !!a.lead]).sort(), [[0, true], [2, false], [3, false]], 'contractor listed as lead is assigned as a member');
    assert.equal(acts['POS Lab Pack Up'].det, '-Pack all supplies');
    // Quiet: no immediate pushes; only 30-minute reminders. "All staff" rows send no in-app notice.
    assert.deepEqual((await pushes()).map(p => p.kind), ['reminder']);
    assert.ok(!(await notes(3)).some(m => /Staff Breakfast/.test(m)));
    assert.ok((await notes(3)).some(m => /New assignment: POS Lab Pack Up/.test(m)));
    // "All staff": acknowledgment and check-in off for that activity.
    const ack = (await db.query("select requires_ack from public.activities where title = 'Staff Breakfast'")).rows[0].requires_ack;
    assert.equal(ack, false);

    // Re-import: changed time and team update the same activity; removed people are told; nothing duplicated.
    data = await command('importSchedule', [1, {}, [{ ...rows[1], start: 600, members: [1] }]]);
    const again = data.activities.filter(a => a.t === 'POS Lab Pack Up');
    assert.equal(again.length, 1);
    assert.equal(again[0].a, 600);
    const team = data.asg.filter(a => a.s === again[0].id);
    assert.deepEqual(team.map(a => a.e).sort(), [0, 1, 2]);
    assert.ok((await notes(3)).some(m => m === 'Removed from: POS Lab Pack Up'));
    const alex = team.find(a => a.e === 0);
    assert.equal(alex.tag, 'changed', 'time change asks the team to acknowledge again');
    assert.deepEqual((await pushes()).map(p => p.kind), ['reminder'], 'still no immediate pushes');

    // Ordinary assigning still pushes immediately (the quiet setting lasts only for the import).
    await command('assign', [0, acts['Return Shipments'].id]);
    assert.ok((await pushes()).some(p => p.kind === 'assignment'));
  } finally { await db.close(); }
});
