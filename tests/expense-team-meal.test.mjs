import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { checkExpense, catText } from '../src/expenses.js';

const admin = '00000000-0000-0000-0000-000000000001';
const rc = (owner, n) => ({ rp: `${owner}/receipt-${n}.jpg`, rt: 'image/jpeg' });

test('Team Meal stores who was there; ISO/Rep Hosting needs notes', async () => {
  assert.equal(catText('team_meal'), 'Team Meal');
  assert.equal(catText('iso_hosting'), 'ISO/Rep Hosting');
  const base = { loc: 'Pollo Tropical', ref: '', date: '2026-11-07', amt: '84.50', pay: 'personal_card', reimb: true, notes: '' };
  assert.match(checkExpense({ ...base, cat: 'team_meal', att: [] }), /Choose who was at the team meal/);
  assert.equal(checkExpense({ ...base, cat: 'team_meal', att: [1] }), '');
  assert.match(checkExpense({ ...base, cat: 'iso_hosting' }), /names and details/);

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
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const snapshot = async () => (await db.query('select public.ops_snapshot() as data')).rows[0].data;
    const command = async (action, args) => (await db.query('select public.ops_command($1,$2::jsonb,$3) as data', [action, JSON.stringify(args), (await snapshot()).revision])).rows[0].data;
    await command('addEvent', [{ n: 'IMPACT26', b: '2026-11-05', d: 9 }]);
    for (const n of ['Bre Binder', 'Erin Washburn', 'Amber Josi']) await command('addStaff', [{ n, r: 'Ops', acct: 'staff', phone: '', map: true }]);
    assert.equal((await snapshot()).teamMeals, true);
    await assert.rejects(command('addExpense', [1, { ...base, cat: 'team_meal', e: 0, att: [], ...rc(0, 1) }]), /Choose who was at the team meal/);
    let data = await command('addExpense', [1, { ...base, cat: 'team_meal', e: 0, att: [2, 1, 1, 99], ...rc(0, 1) }]);
    let x = data.expenses.find(e => e.cat === 'team_meal');
    assert.deepEqual(x.att, [2, 1], 'distinct active people, by name');
    // Changing the type drops the people; ISO/Rep Hosting needs notes.
    await assert.rejects(command('editExpense', [x.id, { ...base, cat: 'iso_hosting', ...rc(0, 1) }]), /names and details/);
    data = await command('editExpense', [x.id, { ...base, cat: 'iso_hosting', notes: 'Hosted ISO reps: Jane Doe (Acme Payments), John Roe', ...rc(0, 1) }]);
    x = data.expenses.find(e => e.id === x.id);
    assert.deepEqual([x.cat, x.att], ['iso_hosting', undefined]);
    // Other expense types are unchanged.
    data = await command('addExpense', [1, { ...base, cat: 'parking', e: 1, ...rc(1, 2) }]);
    assert.equal(data.expenses.length, 2);
  } finally { await db.close(); }
});
