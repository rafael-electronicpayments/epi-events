import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('test emails backfill safely, preserve existing access, and abort collisions atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
    for (const file of ['202610130001_event_ops.sql','202610130002_access_invites.sql','202610130003_restrict_auto_rls.sql','20261014114123_roster_login_email.sql','20261016120000_admin_people_staff_schedule.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    }
    await db.exec(await readFile(new URL('../supabase/seed-mock.sql',import.meta.url),'utf8'));
    const sql = await readFile(new URL('../supabase/backfill-test-emails.sql',import.meta.url),'utf8');
    await db.exec(sql);
    const rows = (await db.query(`select p.name,i.email,i.role from public.people p join public.access_invites i on i.person_id=p.id`)).rows;
    assert.equal(rows.length,29);
    assert.equal(new Set(rows.map(p=>p.email)).size,29);
    assert.equal(rows.find(p=>p.name==='Alex Rivera').email,'arivera@epieventstest.com');
    assert.equal(rows.find(p=>p.name==='Dr. Lena Ford').email,'lford@epieventstest.com');
    assert.equal(rows.find(p=>p.name==='Dr. Lena Ford').role,'contractor');
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);
    const revision = (await db.query('select revision from public.ops_state')).rows[0].revision;
    await db.exec(sql);
    assert.equal((await db.query('select revision from public.ops_state')).rows[0].revision,revision);
    await db.exec(`update public.access_invites set email='existing@example.test' where email='arivera@epieventstest.com'`);
    await db.exec(sql);
    assert.equal((await db.query("select count(*)::int n from public.access_invites where email='existing@example.test'")).rows[0].n,1);
    await db.exec(`insert into public.people(name,account_type) values('New Person','staff'),('Peter Shah','staff')`);
    await assert.rejects(db.exec(sql),/address collision/);
    assert.equal((await db.query("select count(*)::int n from public.access_invites where email='nperson@epieventstest.com'")).rows[0].n,0);
    assert.equal((await db.query('select revision from public.ops_state')).rows[0].revision,revision);
    await db.exec(`update public.people set archived=true where name='Peter Shah';
      insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','nperson@epieventstest.com')`);
    await assert.rejects(db.exec(sql),/address collision/);
    assert.equal((await db.query('select count(*)::int n from public.access_invites')).rows[0].n,29);
  } finally { await db.close(); }
});
