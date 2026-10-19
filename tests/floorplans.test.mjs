import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const mapUser = '00000000-0000-0000-0000-000000000002';
const noMapUser = '00000000-0000-0000-0000-000000000003';

test('floorplans: admin management, map-access viewing, and validation', async () => {
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
    await command('addEvent', [{ n: 'Impact 2028', b: '2028-03-02', d: 2 }]);
    await command('addRoom', ['Ballroom']);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 2, null, 1]);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Sam', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await command('assign', [0, 1]);
    await command('assign', [1, 1]);

    let data = await command('addFloorplan', [1, 'All floors.pdf', '1/0b5e8c1e-1111-4a2b-9c3d-123456789abc.pdf', 2048]);
    assert.deepEqual(data.floorplans.map(f => [f.ev, f.name, f.size]), [[1, 'All floors.pdf', 2048]]);
    data = await command('addFloorplan', [1, 'Level 2', '1/second-floor.pdf', 1024]);
    assert.equal(data.floorplans.length, 2, 'several floorplans per event');

    await assert.rejects(command('addFloorplan', [1, 'Bad', '../escape.pdf', 10]), /Invalid file location/);
    await assert.rejects(command('addFloorplan', [1, 'Bad', '2/other-event.pdf', 10]), /Invalid file location/);
    await assert.rejects(command('addFloorplan', [1, '  ', '1/blank.pdf', 10]), /floorplan name/);
    await assert.rejects(command('addFloorplan', [9, 'X', '9/x.pdf', 10]), /Choose an event/);
    await assert.rejects(command('addFloorplan', [1, 'Huge', '1/huge.pdf', 30000000]));
    await assert.rejects(command('addFloorplan', [1, 'Dupe', '1/second-floor.pdf', 10]));

    data = await command('renameFloorplan', [2, ' Level 2 (rooms 200-260) ']);
    assert.equal(data.floorplans.find(f => f.id === 2).name, 'Level 2 (rooms 200-260)');
    data = await command('moveFloorplan', [2, 2]);
    assert.equal(data.floorplans.find(f => f.id === 2).ev, 2);
    await assert.rejects(command('moveFloorplan', [2, 9]), /Choose an event/);
    await assert.rejects(command('renameFloorplan', [99, 'x']), /no longer exists/);

    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('sam@example.test','staff',1);
      insert into auth.users values('${mapUser}','alex@example.test'),('${noMapUser}','sam@example.test');`);
    await asUser(mapUser);
    data = await snapshot();
    assert.deepEqual(data.floorplans.map(f => f.id), [1, 2], 'map access sees floorplans for the events they can see');
    await assert.rejects(command('addFloorplan', [1, 'Mine', '1/mine.pdf', 10]), /Administrator access required/);
    await assert.rejects(command('delFloorplan', [1]), /Administrator access required/);

    await asUser(noMapUser);
    assert.deepEqual((await snapshot()).floorplans, [], 'no map access, no floorplans');
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int n from public.floorplans')).rows[0].n, 0, 'table rows hidden without map access');
    await assert.rejects(db.query("insert into public.floorplans(event_id,name,path,size) values(1,'x','1/x.pdf',1)"), /permission denied/);
    await db.exec('reset role');

    // Other commands still pass through to the earlier command function.
    await asUser(mapUser);
    data = await command('ack', [1]);
    assert.equal(data.asg.find(a => a.id === 1).ack, 1);

    await asUser(admin);
    data = await command('delFloorplan', [1]);
    assert.deepEqual(data.floorplans.map(f => f.id), [2]);
    await command('delEvent', [2]);
    assert.deepEqual((await snapshot()).floorplans, [], 'deleting an event removes its floorplans');
  } finally { await db.close(); }
});
