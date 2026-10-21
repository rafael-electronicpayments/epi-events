import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const alexUser = '00000000-0000-0000-0000-000000000002';
const patUser = '00000000-0000-0000-0000-000000000003';
const samUser = '00000000-0000-0000-0000-000000000004';

test('documents: admins manage them; people see only documents for them in open events they work', async () => {
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
    const count = async table => { await db.exec('set role authenticated'); try { return (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n; } finally { await db.exec('reset role'); } };

    await asUser(admin);
    await command('addEvent', [{ n: 'Impact 2026', b: '2026-11-07', d: 3 }]);
    await command('addEvent', [{ n: 'Impact 2027', b: '2027-03-02', d: 3 }]);
    await command('addRoom', ['Ballroom']);
    for (const n of ['Alex', 'Pat', 'Sam']) await command('addStaff', [{ n, r: 'Host', acct: n === 'Pat' ? 'contractor' : 'staff', phone: '', map: false }]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 3, null, 1]);
    await command('addSession', ['Opening', 'Ballroom', 0, 540, 600, 1, null, 2]);
    for (const p of [0, 1]) await command('assign', [p, 1]); // Alex and Pat work event 1; Sam works only event 2
    await command('assign', [2, 2]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1),('sam@example.test','staff',2);
      insert into auth.users values('${alexUser}','alex@example.test'),('${patUser}','pat@example.test'),('${samUser}','sam@example.test');`);

    const pdf = 'application/pdf';
    let data = await command('addDocument', [1, 'Run of show', '1/a1.pdf', 1000, pdf, true, []]);
    assert.equal(data.documents.length, 1);
    assert.deepEqual([data.documents[0].name, data.documents[0].all, data.documents[0].who], ['Run of show', true, []]);
    data = await command('addDocument', [1, 'AV cue sheet', '1/a2.xlsx', 2000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false, [1]]);
    data = await command('addDocument', [2, 'Next year plan', '2/b1.pdf', 3000, pdf, true, []]);
    assert.equal(data.documents.length, 3);

    // Validation.
    await assert.rejects(command('addDocument', [1, 'X', '1/x.pdf', 10, pdf, false, []]), /Choose at least one person/);
    await assert.rejects(command('addDocument', [1, 'X', '2/x.pdf', 10, pdf, true, []]), /Invalid document location/);
    await assert.rejects(command('addDocument', [1, ' ', '1/x.pdf', 10, pdf, true, []]), /Enter a document name/);
    await assert.rejects(command('addDocument', [1, 'X', '1/x.html', 10, 'text/html', true, []]), /documents_mime_check|violates check/);
    await assert.rejects(command('addDocument', [1, 'X', '1/x.pdf', 10, pdf, false, [99]]), /active people/);
    await assert.rejects(command('addDocument', [9, 'X', '9/x.pdf', 10, pdf, true, []]), /no longer exists/);

    const names = async user => { await asUser(user); return (await snapshot()).documents.map(d => d.name).sort(); };
    assert.deepEqual(await names(alexUser), ['Run of show'], 'Alex: event 1, for everyone only');
    assert.deepEqual(await names(patUser), ['AV cue sheet', 'Run of show'], 'Pat was selected for the cue sheet');
    assert.deepEqual(await names(samUser), ['Next year plan'], 'Sam works only event 2');
    await asUser(patUser);
    assert.equal((await snapshot()).documents[0].who, undefined, 'viewer lists are for admins only');
    assert.equal(await count('documents'), 2);
    assert.equal(await count('document_access'), 0);
    await assert.rejects(command('delDocument', [1]), /Administrator access required/);
    await assert.rejects(command('addDocument', [1, 'Mine', '1/m.pdf', 10, pdf, true, []]), /Administrator access required/);

    // Admin narrows the run of show to Alex only, then removes the cue sheet.
    await asUser(admin);
    data = await command('editDocument', [1, 'Run of show v2', false, [0]]);
    assert.deepEqual([data.documents.find(d => d.id === 1).name, data.documents.find(d => d.id === 1).who], ['Run of show v2', [0]]);
    await assert.rejects(command('editDocument', [1, 'Run of show v2', false, []]), /Choose at least one person/);
    assert.deepEqual(await names(patUser), ['AV cue sheet']);
    assert.deepEqual(await names(alexUser), ['Run of show v2']);
    await asUser(admin);
    data = await command('delDocument', [2]);
    assert.deepEqual(data.documents.map(d => d.id), [1, 3]);
    data = await command('editDocument', [1, 'Run of show', true, [0]]);
    assert.deepEqual(data.documents.find(d => d.id === 1).who, [], 'everyone clears the selected list');

    // Closed events hide their documents from everyone but admins.
    await command('setEventClosed', [1, true]);
    assert.deepEqual(await names(alexUser), []);
    await asUser(admin);
    assert.equal((await snapshot()).documents.length, 2);
    // Other commands still pass through.
    data = await command('setEventSplash', [1, null]);
    assert.equal(data.documents.length, 2);
  } finally { await db.close(); }
});
