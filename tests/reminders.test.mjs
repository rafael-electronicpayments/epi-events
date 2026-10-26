import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const samUser = '00000000-0000-0000-0000-000000000003';

test('admins send reminders; recipients get a notice and push and acknowledge them', async () => {
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
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 6 }]);
    for (const n of ['Alex Rivera', 'Sam Lee', 'Jordan Park']) await command('addStaff', [{ n, r: 'Host', acct: 'staff', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('sam@example.test','staff',1);
      insert into auth.users values('${alexUser}','alex@example.test'),('${samUser}','sam@example.test');
      insert into public.push_subscriptions(person_id, endpoint, p256dh, auth) values(0, 'https://fcm.googleapis.com/fcm/send/x', '${'k'.repeat(30)}', 'authauth1');`);

    await assert.rejects(command('sendReminder', [1, [0], '   ']), /Write the message/);
    await assert.rejects(command('sendReminder', [1, [0], 'x'.repeat(201)]), /200 characters/);
    await assert.rejects(command('sendReminder', [1, [], 'Hi']), /Choose who/);
    let data = await command('sendReminder', [1, [0, 1, 1], 'Please acknowledge your assignment']);
    assert.equal(data.reminders.length, 1);
    const r = data.reminders[0];
    assert.deepEqual([r.x, r.from, r.to.map(t => t.e), r.to.every(t => t.ack === null)], ['Please acknowledge your assignment', 'An administrator', [0, 1], true]);
    // Push only for the person with a device; in-app notice for both.
    const ob = (await db.query("select person_id, title, body from public.push_outbox where kind = 'notice'")).rows;
    assert.deepEqual(ob, [{ person_id: 0, title: 'Message from An administrator', body: 'Please acknowledge your assignment' }]);

    // Recipient sees it and acknowledges; others can't.
    await asUser(alexUser);
    data = await snapshot();
    const note = data.notes.find(n => n.rid === r.id);
    assert.deepEqual([note.x, note.from, note.done, data.reminders.length, data.reminders[0].ack], ['Please acknowledge your assignment', 'An administrator', 0, 1, null]);
    data = await command('ackReminder', [r.id]);
    assert.ok(data.reminders[0].ack);
    assert.equal(data.notes.find(n => n.rid === r.id).done, 1);
    await asUser(samUser);
    await assert.rejects(command('sendReminder', [1, [0], 'Hi']), /Administrator access required/);
    await asUser(admin);
    data = await snapshot();
    assert.deepEqual(data.reminders[0].to.map(t => [t.e, !!t.ack]), [[0, true], [1, false]]);

    // Closed events: no new reminders, and recipients no longer see them.
    await command('setEventClosed', [1, true]);
    await assert.rejects(command('sendReminder', [1, [1], 'Hi']), /closed/);
    await asUser(samUser);
    data = await snapshot();
    assert.equal(data.reminders.length, 0);
    assert.equal(data.notes.filter(n => n.rid).length, 0);
    await assert.rejects(command('ackReminder', [r.id]), /closed/);

    // Old undelivered reminder pushes are dropped; others get a 2-hour lifetime.
    await asUser(admin);
    await command('setEventClosed', [1, false]);
    await db.exec("update public.push_outbox set created_at = now() - interval '3 hours' where kind = 'notice'");
    await db.query('select public.push_claim(50)');
    assert.equal((await db.query("select status from public.push_outbox where kind = 'notice'")).rows[0].status, 'skipped');
  } finally { await db.close(); }
});
