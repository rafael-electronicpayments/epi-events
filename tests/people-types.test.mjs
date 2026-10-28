import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { typeFromText, typeLabel } from '../src/people-types.js';

const admin = '00000000-0000-0000-0000-000000000001', speakerUser = '00000000-0000-0000-0000-000000000002';

test('type labels and spreadsheet values', () => {
  assert.equal(typeLabel('contractor'), 'Event Staff');
  assert.deepEqual(['Event Staff', 'contractor', 'Speakers', 'PANELIST', 'Admin', 'staff', 'Volunteer'].map(typeFromText), ['contractor', 'contractor', 'speaker', 'panelist', 'admin', 'staff', null]);
});

test('Speakers and Panelists can be saved, sign in, and see only their own assignments; they cannot lead', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin'); insert into auth.users values('${admin}','admin@example.test');`);
    const as = uid => db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await as(admin);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data', [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;
    const save = async (p, id = null) => (await db.query('select public.ops_save_person($1,$2::jsonb,$3) as data', [id, JSON.stringify(p), (await snapshot()).revision])).rows[0].data;
    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 9 }]);
    await command('addRoom', ['Ballroom']);
    await save({ n: 'Ron White', email: 'ron@example.test', r: 'Keynote', acct: 'speaker', phone: '', map: false });
    await save({ n: 'Chase Gunnell', email: '', r: 'Panel', acct: 'panelist', phone: '', map: false });
    await save({ n: 'Alex Rivera', email: '', r: 'Host', acct: 'staff', phone: '', map: false });
    let data = await snapshot();
    assert.deepEqual(data.people.map(p => p.acct), ['speaker', 'panelist', 'staff']);
    await assert.rejects(save({ n: 'X', email: '', r: '', acct: 'volunteer', phone: '', map: false }), /Event Staff, Speaker, or Panelist/);
    await command('addSession', ['Keynote', 'Ballroom', 5, 540, 600, 1, null, 1]);
    await command('addSession', ['Panel', 'Ballroom', 5, 600, 660, 1, null, 1]);
    data = await command('assign', [0, 1]);
    data = await command('assign', [1, 2]);
    await assert.rejects(command('setLead', [data.asg.find(a => a.e === 0).id, true]), /Team leads must be Staff or Admin/);
    await db.exec(`insert into auth.users values('${speakerUser}','ron@example.test');`);
    await as(speakerUser);
    data = await snapshot();
    assert.equal(data.role, 'speaker');
    assert.deepEqual(data.asg.map(a => a.e), [0], 'only his own assignment');
  } finally { await db.close(); }
});
