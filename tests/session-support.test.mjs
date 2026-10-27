import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';

test('Session Support: import, edit, people groups, notes, and who sees what', async () => {
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
    const as = async uid => db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await as(admin);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data',
      [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;
    const notes = async e => (await db.query('select message from public.notifications where person_id = $1 order by id', [e])).rows.map(r => r.message);
    const pushes = async () => (await db.query("select count(*)::int n from public.push_outbox where kind = 'notice'")).rows[0].n;

    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 9, tz: 'America/Puerto_Rico' }]);
    for (const [n, email] of [['Michelle Richter', ''], ['Christina Verity', ''], ['Jen Fontana', ''], ['Keith Ashcraft', '']])
      await command('addStaff', [{ n, email, r: 'Marketing', acct: 'staff', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('michelle@example.test','staff',0);
      insert into auth.users values('${staffUser}','michelle@example.test');`);
    await db.exec(`insert into public.push_subscriptions(person_id, endpoint, p256dh, auth) values(2, 'https://fcm.googleapis.com/fcm/send/x', '${'k'.repeat(30)}', 'authauth1')`);
    assert.deepEqual((await snapshot()).support, []);

    const keynote = { d: 5, a: 540, b: 630, blk: 'General Session', trk: 'General Session', t: 'Keynote Address', r: 'Rio Mar 5 & 6', sp: 'Michael Nardy, CEO',
      roles: [{ box: 'nt', label: 'Notetaker' }, { box: 'nt', label: 'Notes & pull quotes' }, { box: 'md', label: 'Q&A mics' }],
      ppl: [{ box: 'nt', role: 'Notetaker', e: 0 }, { box: 'nt', role: 'Notes & pull quotes', e: 1 }, { box: 'nt', role: 'Notes & pull quotes', e: 2 }, { box: 'md', role: 'Q&A mics', e: 3 }] };
    const lunch = { d: 5, a: 750, b: 810, blk: 'Breakouts', t: 'Lunch', r: 'Rio Mar 7-10', brk: true, note: 'Last call 12:20 & 12:30 PM', roles: [], ppl: [] };
    let data = await command('importSupport', [1, [keynote, lunch]]);
    assert.equal(data.support.length, 2);
    let k = data.support.find(s => s.t === 'Keynote Address');
    assert.deepEqual(k.ppl.map(p => [p.box, p.role, p.n]), [['md', 'Q&A mics', 'Keith Ashcraft'], ['nt', 'Notetaker', 'Michelle Richter'], ['nt', 'Notes & pull quotes', 'Christina Verity'], ['nt', 'Notes & pull quotes', 'Jen Fontana']]);
    assert.deepEqual(await notes(0), ['Session Support: Keynote Address (Tue, Nov 10, 9:00 AM)']);
    assert.equal(await pushes(), 0, 'no pushes during an import');

    // Notes, then a re-import (same day, time, title) updates in place, keeps notes, and tells people taken off.
    await command('setSupportNotes', [k.id, 'nt', 'Pull quotes for social by 5 PM']);
    data = await command('importSupport', [1, [{ ...keynote, sp: 'Michael Nardy, CEO and guests', ppl: keynote.ppl.filter(p => p.e !== 2) }]]);
    assert.equal(data.support.length, 2);
    k = data.support.find(s => s.id === k.id);
    assert.deepEqual([k.sp, k.ntn, k.ppl.length], ['Michael Nardy, CEO and guests', 'Pull quotes for social by 5 PM', 3]);
    assert.deepEqual(await notes(2), ['Session Support: Keynote Address (Tue, Nov 10, 9:00 AM)', 'Removed from Session Support: Keynote Address']);

    // Adding by hand: notice and a push.
    data = await command('setSupportPeople', [k.id, 'nt', 'Notetaker', [0, 1]]);
    assert.equal(await pushes(), 0, 'Christina was already on the card');
    data = await command('setSupportPeople', [k.id, 'nt', 'Notetaker', [0, 1, 2]]);
    assert.equal(await pushes(), 1, 'Jen is new to the card and has a phone registered');
    data = await command('setSupportPeople', [k.id, 'md', 'Help with doors', [3]]);
    k = data.support.find(s => s.id === k.id);
    assert.ok(k.roles.some(r => r.box === 'md' && r.label === 'Help with doors'), 'new group added');
    // Editing details; removing a group removes its people.
    data = await command('saveSupport', [k.id, 1, { d: 5, a: 540, b: 630, blk: 'General Session', trk: '', t: 'Keynote Address', r: 'Rio Mar 5 & 6', sp: 'x', roles: k.roles.filter(r => r.label !== 'Help with doors') }]);
    k = data.support.find(s => s.id === k.id);
    assert.ok(!k.ppl.some(p => p.role === 'Help with doors'));
    await assert.rejects(command('saveSupport', [null, 1, { d: 12, a: 540, b: 600, t: 'Late' }]), /outside the event/);

    // Michelle (staff) sees only her card, with everyone on it.
    await as(staffUser);
    let mine = (await snapshot()).support;
    assert.deepEqual(mine.map(s => s.t), ['Keynote Address']);
    assert.ok(mine[0].ppl.some(p => p.n === 'Keith Ashcraft'));
    await assert.rejects(command('setSupportNotes', [k.id, 'nt', 'x']), /Administrator/);
    await as(admin);
    await command('delSupport', [k.id]);
    assert.ok((await notes(0)).includes('Session Support cancelled: Keynote Address'));
    await as(staffUser);
    assert.deepEqual((await snapshot()).support, []);
  } finally { await db.close(); }
});
