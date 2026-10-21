import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';

test('event logos: admins set, replace, and remove; everyone sees the logo of open events', async () => {
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
    let data = await snapshot();
    assert.equal(data.logos, true, 'the snapshot reports logo support');
    assert.equal(data.events[0].logo, undefined);

    data = await command('setEventLogo', [1, '1/logo-a.png', 'image/png']);
    assert.deepEqual([data.events[0].logo, data.events[0].logoType], ['1/logo-a.png', 'image/png']);
    assert.equal(data.events[0].tz, 'America/New_York', 'earlier snapshot fields are kept');
    data = await command('setEventLogo', [1, '1/logo-b.webp', 'image/webp']);
    assert.equal(data.events[0].logo, '1/logo-b.webp');

    await assert.rejects(command('setEventLogo', [1, '2/logo.png', 'image/png']), /Invalid logo location/);
    await assert.rejects(command('setEventLogo', [1, '1/../x.png', 'image/png']), /Invalid logo location/);
    await assert.rejects(command('setEventLogo', [1, '1/logo.svg', 'image/svg+xml']), /PNG or WebP/);
    await assert.rejects(command('setEventLogo', [99, '99/logo.png', 'image/png']), /no longer exists/);

    // Staff see the logo of an open event they're assigned to, but can't change it.
    await command('addRoom', ['Ballroom']);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 1, null, 1]);
    await command('assign', [0, 1]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${staffUser}','alex@example.test');`);
    await asUser(staffUser);
    data = await snapshot();
    assert.equal(data.events[0].logo, '1/logo-b.webp');
    await assert.rejects(command('setEventLogo', [1, null]), /Administrator access required/);

    await asUser(admin);
    data = await command('setEventLogo', [1, null]);
    assert.equal(data.events[0].logo, undefined);
    assert.equal((await db.query('select logo_path, logo_type from public.events where id = 1')).rows[0].logo_type, null);
    // Other commands still pass through to the earlier command functions.
    data = await command('editEvent', [1, { n: 'Impact 26', b: '2026-11-07', d: 3, tz: 'America/Halifax' }]);
    assert.deepEqual([data.events[0].name, data.events[0].tz], ['Impact 26', 'America/Halifax']);
  } finally { await db.close(); }
});
