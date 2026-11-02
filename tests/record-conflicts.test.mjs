import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001', alexUser = '00000000-0000-0000-0000-000000000002';

test('record-level conflicts and light saves', async () => {
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
    const rev = async () => (await snapshot()).revision;
    const run = async (fn, action, args, r) => (await db.query(`select public.${fn}($1,$2::jsonb,$3) as data`, [action, JSON.stringify(args), r])).rows[0].data;
    const command = async (action, args, r) => run('ops_command', action, args, r ?? await rev());
    const light = async (action, args, r) => run('ops_command_light', action, args, r ?? await rev());
    const person = async (id, p, r) => (await db.query('select public.ops_save_person($1,$2::jsonb,$3) as data', [id, JSON.stringify(p), r ?? await rev()])).rows[0].data;
    const personLight = async (id, p, r) => (await db.query('select public.ops_save_person_light($1,$2::jsonb,$3) as data', [id, JSON.stringify(p), r ?? await rev()])).rows[0].data;

    await command('addStaff', [{ n: 'Alex Rivera', r: 'Ops', acct: 'staff', phone: '', map: true }]).catch(() => null);
    await person(null, { n: 'Pat Quinn', r: 'Ops', acct: 'staff', phone: '', map: true, email: 'pat@example.test' });
    await person(null, { n: 'Sam Lee', r: 'Ops', acct: 'staff', phone: '', map: true, email: 'sam@example.test' });
    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3, mon: [] }]).catch(() => command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 3 }]));
    await command('addRoom', ['Lobby']);
    await command('addRoom', ['Ballroom']);
    await command('addSession', ['Registration', 'Lobby', 0, 480, 600, 3, null, 1]);
    await command('addSession', ['Keynote', 'Ballroom', 0, 540, 600, 3, null, 1]);
    let data = await snapshot();
    assert.equal(data.lightSaves, true, 'the snapshot announces light saves');
    const reg = data.activities.find(a => a.t === 'Registration' || a.title === 'Registration' || a.n === 'Registration') ?? data.activities[0];
    const key = data.activities.find(a => a.id !== reg.id);
    const people = data.people.map(p => p.id ?? p.e).filter(x => x != null);

    // 1. Unrelated saves on stale data now go through (they used to be refused).
    const opened = await rev();
    await command('addRoom', ['Terrace']);                         // someone else saves first
    data = await command('addRoom', ['Patio'], opened);             // my save, on the older revision
    assert.ok(data.rooms.some(r => (r.name ?? r.n ?? r) === 'Patio' || JSON.stringify(r).includes('Patio')), 'stale unrelated save accepted');

    // 2. Edit dialogs: refused only when that same record changed since the dialog opened.
    const editorOpenedAt = await rev();
    await command('editSession', [key.id, 'Opening keynote', 'Ballroom', 0, 540, 600, 3, null]);  // someone edits the keynote
    await assert.rejects(command('editSession', [key.id, 'Keynote (moved)', 'Ballroom', 0, 600, 660, 3, null], editorOpenedAt),
      e => e.code === 'PT409' && /Someone else changed this activity/.test(e.message), 'same activity: refused with a clear message');
    data = await command('editSession', [reg.id, 'Registration desk', 'Lobby', 0, 480, 600, 2, null], editorOpenedAt);
    assert.ok(JSON.stringify(data.activities).includes('Registration desk'), 'other activity: accepted');
    // The refused editor reopens (current revision) and saves fine.
    data = await command('editSession', [key.id, 'Keynote (moved)', 'Ballroom', 0, 600, 660, 3, null]);
    assert.ok(JSON.stringify(data.activities).includes('Keynote (moved)'));

    // 3. People through ops_save_person: same person refused, another person and new people fine.
    const [pat, sam] = people.slice(-2);
    const peopleOpenedAt = await rev();
    await person(pat, { n: 'Pat Quinn', r: 'Lead', acct: 'staff', phone: '', map: true, email: 'pat@example.test' });
    await assert.rejects(person(pat, { n: 'Patricia Quinn', r: 'Ops', acct: 'staff', phone: '', map: true, email: 'pat@example.test' }, peopleOpenedAt),
      e => e.code === 'PT409' && /Someone else changed this person/.test(e.message));
    await person(sam, { n: 'Samuel Lee', r: 'Ops', acct: 'staff', phone: '', map: true, email: 'sam@example.test' }, peopleOpenedAt);
    await person(null, { n: 'New Person', r: 'Ops', acct: 'staff', phone: '', map: true, email: 'new@example.test' }, peopleOpenedAt);
    data = await snapshot();
    assert.ok(JSON.stringify(data.people).includes('Samuel Lee') && JSON.stringify(data.people).includes('New Person'));

    // 4. Rooms are named by their old name.
    const roomsOpenedAt = await rev();
    await command('editRoom', ['Terrace', 'Upper terrace']);
    await assert.rejects(command('editRoom', ['Patio', 'Garden patio'], roomsOpenedAt).then(() => command('editRoom', ['Upper terrace', 'Roof'], roomsOpenedAt)),
      e => e.code === 'PT409' && /room/.test(e.message));

    // 5. Light saves: same effect, tiny answer, setting not left on.
    let before = await rev();
    const answer = await light('addRoom', ['Light room']);
    assert.deepEqual(Object.keys(answer).sort(), ['light', 'revision']);
    assert.equal(answer.light, true);
    assert.equal(answer.revision, before + 1);
    data = await snapshot();
    assert.equal(data.revision, answer.revision);
    assert.ok(JSON.stringify(data.rooms).includes('Light room'), 'the light save was saved');
    assert.ok(Array.isArray(data.people) && data.people.length > 0, 'later snapshots are full');
    assert.equal((await db.query("select current_setting('ops.light', true) as v")).rows[0].v || '', '');
    before = await rev();
    const pAnswer = await personLight(null, { n: 'Light Person', r: 'Ops', acct: 'staff', phone: '', map: true, email: 'light@example.test' });
    assert.equal(pAnswer.light, true);
    assert.equal(pAnswer.revision, before + 1);
    assert.ok(JSON.stringify((await snapshot()).people).includes('Light Person'));
    // Bulk command through the light path.
    const ids = (await snapshot()).people.map(p => p.id ?? p.e).filter(x => x != null).slice(0, 3);
    const bulk = await light('assignMany', [ids, reg.id]);
    assert.equal(bulk.light, true);
    assert.ok((await snapshot()).asg.filter(a => a.s === reg.id).length >= 1);
    // Light edit conflicts are refused the same way.
    const lightOpenedAt = await rev();
    await command('editSession', [reg.id, 'Registration', 'Lobby', 0, 480, 600, 2, null]);
    await assert.rejects(light('editSession', [reg.id, 'Reg', 'Lobby', 0, 480, 600, 2, null], lightOpenedAt), e => e.code === 'PT409');
    assert.equal((await db.query("select current_setting('ops.light', true) as v")).rows[0].v || '', '', 'a refused light save leaves no setting behind');

    // 6. Permissions are unchanged: a staff member still can't run admin commands, light or not.
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alexuser@example.test','staff',${people[0]}) on conflict do nothing; insert into auth.users values('${alexUser}','alexuser@example.test');`);
    await as(alexUser);
    await assert.rejects(light('addRoom', ['Nope']), /Administrator/);
    await assert.rejects(command('addRoom', ['Nope']), /Administrator/);
    await as(admin);
    assert.equal((await db.query("select count(*)::int n from public.rooms where name = 'Nope'")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
