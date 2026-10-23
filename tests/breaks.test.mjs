import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const samUser = '00000000-0000-0000-0000-000000000003';

test('scheduled breaks, clocking out and in, and permissions', async () => {
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
    await command('addEvent', [{ n: 'Impact', b: '2027-03-02', d: 2 }]);
    await command('addRoom', ['POS Lab']);
    await command('addSession', ['POS Lab: demo support', 'POS Lab', 0, 540, 1020, 3, null, 1]);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Sam', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Pat', r: 'AV', acct: 'contractor', phone: '', map: false }]);
    for (const p of [0, 1, 2]) await command('assign', [p, 1]);

    // Group lunch for two people, individual break for one.
    let data = await command('addBreak', ['lunch', 0, 720, 750, [0, 1], 1]);
    assert.equal(data.breaks.length, 2);
    data = await command('addBreak', ['break', 0, 900, 915, [0], 1]);
    assert.equal(data.breaks.length, 3);
    assert.deepEqual(data.breaks.map(b => [b.e, b.k, b.a, b.b]), [[0, 'lunch', 720, 750], [1, 'lunch', 720, 750], [0, 'break', 900, 915]]);
    const notes = (await db.query("select message from public.notifications where person_id=0 and assignment_id is null order by id")).rows.map(r => r.message);
    assert.deepEqual(notes, ['Lunch scheduled: 12:00 PM-12:30 PM (Tuesday, Mar 2)', 'Break scheduled: 3:00 PM-3:15 PM (Tuesday, Mar 2)']);

    await assert.rejects(command('addBreak', ['nap', 0, 720, 750, [0], 1]), /Lunch or Break/);
    await assert.rejects(command('addBreak', ['lunch', 0, 750, 720, [0], 1]), /End time/);
    await assert.rejects(command('addBreak', ['lunch', 5, 720, 750, [0], 1]), /day within the event/);
    await assert.rejects(command('addBreak', ['lunch', 0, 720, 750, [], 1]), /at least one person/);

    data = await command('editBreak', [2, 'lunch', 0, 750, 780]);
    assert.deepEqual([data.breaks.find(b => b.id === 2).a, data.breaks.find(b => b.id === 2).b], [750, 780]);
    assert.ok((await db.query("select 1 from public.notifications where person_id=1 and message like 'Lunch changed:%'")).rows.length);

    // Staff accounts.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('sam@example.test','staff',1);
      insert into auth.users values('${alexUser}','alex@example.test'),('${samUser}','sam@example.test');`);
    await asUser(alexUser);
    data = await snapshot();
    assert.deepEqual(data.breaks.map(b => b.e), [0, 0], 'staff see only their own breaks');
    await assert.rejects(command('addBreak', ['lunch', 0, 720, 750, [0], 1]), /Administrator access required/);
    await assert.rejects(command('delBreak', [1]), /Administrator access required/);
    await assert.rejects(command('clockIn', []), /not clocked out/);

    // Clock out linked to own scheduled lunch; someone else's break id is ignored.
    data = await command('clockOut', ['lunch', 1]);
    assert.equal(data.clocks.length, 1);
    assert.equal(data.clocks[0].bid, 1);
    assert.equal(data.clocks[0].in, null);
    await assert.rejects(command('clockOut', ['break', null]), /already clocked out/);
    data = await command('clockIn', []);
    assert.ok(data.clocks[0].in);

    await asUser(samUser);
    data = await command('clockOut', ['lunch', 1]);
    assert.equal(data.clocks.length, 1, 'staff see only their own clock events');
    assert.equal(data.clocks[0].bid, null, "another person's break is not linked");

    // Admin sees everyone, including who is out now; deleting a break keeps the clock record.
    await asUser(admin);
    data = await snapshot();
    assert.equal(data.clocks.length, 2);
    assert.equal(data.clocks.filter(c => c.in === null).length, 1);
    await assert.rejects(command('clockOut', ['lunch', null]), /Only people on the roster/);
    data = await command('delBreak', [1]);
    assert.equal(data.breaks.length, 2);
    assert.equal(data.clocks.find(c => c.e === 0).bid, null);
    assert.ok((await db.query("select 1 from public.notifications where person_id=0 and message like 'Lunch cancelled:%'")).rows.length);

    // Archived people drop out of the snapshot; tables are read-only to API callers.
    await command('delStaff', [1]);
    data = await snapshot();
    assert.deepEqual(data.breaks.map(b => b.e), [0]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query("insert into public.breaks(event_id,person_id,kind,day,start_minute,end_minute) values(1,0,'lunch',0,1,2)"), /permission denied/);
    await assert.rejects(db.query("update public.clocks set in_at=now()"), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
