import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('original mock imports once, preserves edits, and maps generated IDs', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
    await db.exec(await readFile(new URL('../supabase/migrations/202610130001_event_ops.sql',import.meta.url),'utf8'));
    // Simulate sequence gaps left by rolled-back verification transactions.
    await db.exec("select setval(pg_get_serial_sequence('public.people','id'),50); select setval(pg_get_serial_sequence('public.events','id'),20)");
    const sql = await readFile(new URL('../supabase/seed-mock.sql',import.meta.url),'utf8');
    await db.exec(sql);
    const counts = (await db.query(`select (select count(*)::int from public.events) events,
      (select count(*)::int from public.people) people, (select count(*)::int from public.rooms) rooms,
      (select count(*)::int from public.activities) activities,(select count(*)::int from public.assignments) assignments,
      (select count(*)::int from public.notifications where not done) notifications`)).rows[0];
    assert.deepEqual(counts,{events:2,people:29,rooms:8,activities:12,assignments:32,notifications:3});
    const alex = (await db.query(`select s.title from public.assignments a join public.people p on p.id=a.person_id
      join public.activities s on s.id=a.activity_id where p.name='Alex Rivera'`)).rows;
    assert.deepEqual(alex,[{title:'Demo showcase'}]);
    assert.equal((await db.query('select count(*)::int n from public.assignments where checked_in')).rows[0].n,2);
    await db.exec("update public.events set name='Edited event' where name='IMPACT27'");
    await db.exec(sql);
    assert.equal((await db.query("select count(*)::int n from public.events where name='Edited event'")).rows[0].n,1);
    assert.equal((await db.query('select revision from public.ops_state')).rows[0].revision,1);
    // A fresh workspace with existing content must never be replaced by the seed.
    await db.exec("delete from public.activity_log where action='Imported original mock schedules'");
    await assert.rejects(db.exec(sql),/empty scheduling workspace/);
    assert.equal((await db.query('select count(*)::int n from public.assignments')).rows[0].n,32);
  } finally { await db.close(); }
});
