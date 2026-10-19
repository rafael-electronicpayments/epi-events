import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staff = '00000000-0000-0000-0000-000000000002';
const outsider = '00000000-0000-0000-0000-000000000003';
const contractor = '00000000-0000-0000-0000-000000000004';

test('database permissions, persistence, acknowledgments, and concurrent edits', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    for (const file of ['202610130001_event_ops.sql', '202610130002_access_invites.sql', '202610130003_restrict_auto_rls.sql','20261014114123_roster_login_email.sql','20261016120000_admin_people_staff_schedule.sql','20261019120000_ack_checkin_flags.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    }
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin');
      insert into auth.users values('${admin}','admin@example.test');
      insert into auth.users values('${outsider}','outsider@example.test');`);
    const asUser = async id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args, revision) => {
      const version = revision ?? (await snapshot()).revision;
      return (await db.query('select public.ops_command($1,$2::jsonb,$3) as data', [action, JSON.stringify(args), version])).rows[0].data;
    };
    await asUser(admin);
    assert.equal((await snapshot()).role, 'admin');
    await command('addEvent', [{ n: 'Impact', b: '2027-03-02', d: 3 }]);
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: 'private', map: true }]);
    await command('addStaff', [{ n: 'Other', r: 'Host', acct: 'contractor', phone: 'private', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 2, 1]);
    await command('addSession', ['Workshop', 'Ballroom', 1, 540, 600, 1, 1]);
    await command('assign', [0, 1]);
    await command('assign', [1, 2]);
    await assert.rejects(command('assign', [0, 1]), /duplicate key/);
    const before = await snapshot();
    await command('addRoom', ['Salon']);
    await assert.rejects(command('addRoom', ['Stale'], before.revision), /Another user changed/);
    assert.equal((await snapshot()).rooms.includes('Stale'), false);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('staff@example.test','staff',0);
      insert into auth.users values('${staff}','staff@example.test');`);
    await asUser(outsider);
    await assert.rejects(snapshot(), /not been provisioned/);
    await asUser(staff);
    const mine = await snapshot();
    // Staff can view the full schedule, but never phone numbers or other people's emails.
    assert.equal(mine.people.length, 2);
    assert.ok(mine.people.every(p => p.phone === ''));
    assert.equal(mine.people.find(p => p.id === 1).email, '');
    assert.equal(mine.activities.length, 2);
    assert.equal(mine.asg.length, 2);
    assert.equal(mine.notes.every(n => n.e === 0), true);
    assert.deepEqual(mine.log, []);
    await assert.rejects(command('addRoom', ['Forbidden']), /Administrator access/);
    await assert.rejects(command('ack', [2]), /Access denied/);
    await assert.rejects(command('checkIn', [1]), /Acknowledge/);
    await command('ack', [1]);
    await command('checkIn', [1]);
    assert.equal((await snapshot()).asg[0].in, 1);
    await asUser(admin);
    await command('editSession', [1, 'Keynote', 'Ballroom', 0, 550, 610, 2]);
    await asUser(staff);
    const changed = await snapshot();
    assert.equal(changed.asg[0].ack, 0);
    assert.equal(changed.asg[0].in, 0);
    assert.equal(changed.asg[0].seq, 1);
    assert.equal(changed.notes.filter(n => !n.done).length, 1);
    // Use the actual authenticated database role to exercise RLS and grants.
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from public.people')).rows.length, 1);
    assert.equal((await db.query('select * from public.activities')).rows.length, 1);
    assert.equal((await db.query('select * from public.rooms')).rows.length, 1);
    await assert.rejects(db.exec("update public.profiles set role='admin'"), /permission denied/);
    await assert.rejects(db.exec("insert into public.rooms(name) values('Bypass')"), /permission denied/);
    await command('ack', [1]);
    await db.exec('reset role; set role anon');
    await assert.rejects(snapshot(), /permission denied/);
    await db.exec('reset role');
    await asUser(admin);
    await command('delStaff', [0]);
    await asUser(staff);
    await assert.rejects(snapshot(), /disabled/);
    // Contractors still see only their own schedule.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('contractor@example.test','contractor',1);
      insert into auth.users values('${contractor}','contractor@example.test');`);
    await asUser(contractor);
    const theirs = await snapshot();
    assert.equal(theirs.role, 'contractor');
    assert.equal(theirs.people.length, 1);
    assert.equal(theirs.activities.length, 1);
    assert.deepEqual(theirs.asg.map(a => a.e), [1]);
    assert.match(theirs.notes[0].x, /\(Wednesday, Mar 3\)$/);
  } finally { await db.close(); }
});
