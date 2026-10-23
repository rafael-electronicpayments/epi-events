import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';

test('app settings: admins set name, Home Screen name, tagline, and icon; branding is public', async () => {
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
    const publicBranding = async () => { await db.exec('set role anon'); try { return (await db.query('select public.app_branding() as b')).rows[0].b; } finally { await db.exec('reset role'); } };

    // Defaults, readable before sign-in.
    let b = await publicBranding();
    assert.deepEqual([b.name, b.short, b.tagline, b.icon, b.bg], ['Impact Event Ops', 'Event Ops', '', null, '#ffffff']);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.app_settings'), /permission denied/);
    await db.exec('reset role');

    await asUser(admin);
    let data = await command('setBranding', [{ name: ' Impact 2027 ', short: 'Impact', tagline: 'Payments. People. Possibilities.', bg: '#0B6E6B', icon: 'a1b2c3d4-icon' }]);
    assert.deepEqual([data.branding.name, data.branding.short, data.branding.tagline, data.branding.icon, data.branding.bg], ['Impact 2027', 'Impact', 'Payments. People. Possibilities.', 'a1b2c3d4-icon', '#0b6e6b']);
    // Leaving the icon out keeps it; a blank Home Screen name falls back to the first 12 characters of the name.
    data = await command('setBranding', [{ name: 'Impact Conference 2028', short: '', tagline: '' }]);
    assert.deepEqual([data.branding.name, data.branding.short, data.branding.icon], ['Impact Conference 2028', 'Impact Confe', 'a1b2c3d4-icon']);
    data = await command('setBranding', [{ name: 'Impact 2028', short: 'Impact', tagline: '', icon: null }]);
    assert.equal(data.branding.icon, null, 'icon reset to the default');
    assert.equal((await publicBranding()).name, 'Impact 2028');

    for (const [o, re] of [[{ name: '' }, /app name/], [{ name: 'x'.repeat(41) }, /app name/], [{ name: 'A', short: 'x'.repeat(13) }, /Home Screen name/],
      [{ name: 'A', tagline: 'x'.repeat(121) }, /tagline/], [{ name: 'A', bg: 'blue' }, /background color/], [{ name: 'A', icon: '../x' }, /Invalid icon/]]) {
      await assert.rejects(command('setBranding', [o]), re);
    }

    // Staff see the branding but can't change it.
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0);
      insert into auth.users values('${staffUser}','alex@example.test');`);
    await asUser(staffUser);
    assert.equal((await snapshot()).branding.name, 'Impact 2028');
    await assert.rejects(command('setBranding', [{ name: 'Hacked' }]), /Administrator access required/);
  } finally { await db.close(); }
});
