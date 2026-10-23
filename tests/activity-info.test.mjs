import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';
const contractorUser = '00000000-0000-0000-0000-000000000003';

test('activity details for everyone, notes for admins only, and team leads among the assigned', async () => {
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
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 3 }]);
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex Rivera', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await command('addStaff', [{ n: 'Pat Quinn', r: 'AV', acct: 'contractor', phone: '', map: false }]);
    await command('addStaff', [{ n: 'Steve Messemer', r: 'Director', acct: 'admin', phone: '', map: false }]);

    // Create with details and notes; create without (older app) still works.
    let data = await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 3, null, 1, { det: '  Wear the blue shirt. Doors at 8:45.  ', nt: 'VIP seating rows A-C' }]);
    let s = data.activities.find(x => x.t === 'Keynote');
    assert.deepEqual([s.det, s.nt, s.leads], ['Wear the blue shirt. Doors at 8:45.', 'VIP seating rows A-C', []]);
    assert.equal(data.activityInfo, true);
    data = await command('addSession', ['Lunch desk', 'Ballroom', 0, 720, 780, 1, null, 1]);
    assert.deepEqual([data.activities.find(x => x.t === 'Lunch desk').det, data.activities.find(x => x.t === 'Lunch desk').nt], ['', '']);
    await assert.rejects(command('addSession', ['Too long', 'Ballroom', 0, 540, 600, 1, null, 1, { det: 'x'.repeat(2001) }]), /2,000 characters/);

    // Edit changes details/notes; an edit without the info object leaves them alone.
    data = await command('editSession', [s.id, 'Keynote', 'Ballroom', 0, 540, 600, 3, null, { det: 'Doors at 8:30.', nt: 'Rows A-D' }]);
    s = data.activities.find(x => x.id === s.id);
    assert.deepEqual([s.det, s.nt], ['Doors at 8:30.', 'Rows A-D']);
    data = await command('editSession', [s.id, 'Opening keynote', 'Ballroom', 0, 540, 600, 3, null]);
    s = data.activities.find(x => x.id === s.id);
    assert.deepEqual([s.t, s.det, s.nt], ['Opening keynote', 'Doors at 8:30.', 'Rows A-D']);

    // Assign three people; mark leads. Leads count toward staffing because they are assignments.
    for (const p of [0, 1, 2]) await command('assign', [p, s.id]);
    data = await snapshot();
    const ids = Object.fromEntries(data.asg.filter(a => a.s === s.id).map(a => [a.e, a.id]));
    const asg = e => ({ ...data.asg.find(a => a.s === s.id && a.e === e), id: ids[e] });
    assert.equal(asg(0).lead, false);
    data = await command('setLead', [asg(0).id, true]);
    data = await command('setLead', [asg(2).id, true]);
    assert.deepEqual(data.activities.find(x => x.id === s.id).leads.map(l => l.n), ['Alex Rivera', 'Steve Messemer']);
    assert.equal(data.asg.filter(a => a.s === s.id).length, 3, 'leads are still assignments');
    await assert.rejects(command('setLead', [asg(1).id, true]), /Staff or Admin/);
    await assert.rejects(command('setLead', [9999, true]), /no longer exists/);

    // Staff and contractors see details and leads, never notes, and can't set leads.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${staffUser}','alex@example.test'),('${contractorUser}','pat@example.test');`);
    for (const user of [staffUser, contractorUser]) {
      await asUser(user);
      data = await snapshot();
      const mine = data.activities.find(x => x.id === s.id);
      assert.equal(mine.det, 'Doors at 8:30.');
      assert.equal(mine.nt, undefined, 'notes are admin-only');
      assert.deepEqual(mine.leads.map(l => l.n), ['Alex Rivera', 'Steve Messemer']);
      await assert.rejects(command('setLead', [data.asg[0].id, false]), /Administrator access required/);
    }

    // Unmarking and removing an assignment drops the lead.
    await asUser(admin);
    data = await command('setLead', [asg(2).id, false]);
    assert.deepEqual(data.activities.find(x => x.id === s.id).leads.map(l => l.n), ['Alex Rivera']);
    data = await command('remove', [asg(0).id]);
    assert.deepEqual(data.activities.find(x => x.id === s.id).leads, []);
  } finally { await db.close(); }
});
