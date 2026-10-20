import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staffUser = '00000000-0000-0000-0000-000000000002';
const contractorUser = '00000000-0000-0000-0000-000000000003';

// Synthetic data only.
const meal = { cat: 'lunch', loc: 'Corner Cafe', ref: 'R-1001', date: '2027-03-02', amt: '18.40', pay: 'personal_card', reimb: true, notes: 'Team lunch: A. Example' };
// Every expense needs its own uploaded receipt (photo or PDF) in the owner's folder.
const rc = (owner, n, type = 'image/jpeg') => ({ rp: `${owner}/receipt-${n}.${type === 'application/pdf' ? 'pdf' : 'jpg'}`, rt: type });

test('expenses: own entry, receipts, approval lock, and admin visibility', async () => {
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
    await command('addEvent', [{ n: 'Impact', b: '2027-03-02', d: 3 }]);
    await command('addStaff', [{ n: 'Alex', r: 'Host', acct: 'staff', phone: '', map: true }]);
    await command('addStaff', [{ n: 'Pat', r: 'AV', acct: 'contractor', phone: '', map: false }]);
    await db.exec(`insert into public.access_invites(email,role,person_id) values('alex@example.test','staff',0),('pat@example.test','contractor',1);
      insert into auth.users values('${staffUser}','alex@example.test'),('${contractorUser}','pat@example.test');`);

    // Staff enter their own expenses, with and without a receipt.
    await asUser(staffUser);
    await assert.rejects(command('addExpense', [1, meal]), /Attach a photo or PDF of the receipt/, 'a receipt is required');
    await assert.rejects(command('addExpense', [1, { ...meal, rp: '', rt: '' }]), /Attach a photo or PDF of the receipt/);
    let data = await command('addExpense', [1, { ...meal, ...rc(0, 1) }]);
    assert.equal(data.expenses.length, 1);
    assert.deepEqual([data.expenses[0].e, data.expenses[0].cat, Number(data.expenses[0].amt), data.expenses[0].date, data.expenses[0].ok], [0, 'lunch', 18.4, '2027-03-02', false]);
    data = await command('addExpense', [1, { cat: 'parking', loc: 'Garage', ref: '', date: '2027-03-03', amt: '26', pay: 'cash', reimb: true, notes: '', ...rc(0, 2, 'application/pdf') }]);
    assert.equal(data.expenses.length, 2);

    // Validation.
    const m3 = { ...meal, ...rc(0, 3) };
    await assert.rejects(command('addExpense', [1, { ...m3, cat: 'spa' }]), /expense type/);
    await assert.rejects(command('addExpense', [1, { ...m3, pay: 'crypto' }]), /payment method/);
    await assert.rejects(command('addExpense', [1, { ...m3, amt: '0' }]), /greater than zero/);
    await assert.rejects(command('addExpense', [1, { ...m3, amt: '12.345' }]), /two decimals/);
    await assert.rejects(command('addExpense', [1, { ...m3, amt: '-5' }]), /greater than zero/);
    await assert.rejects(command('addExpense', [1, { ...m3, date: 'soon' }]), /date/);
    await assert.rejects(command('addExpense', [1, { ...m3, cat: 'other', notes: ' ' }]), /Add a note/);
    await assert.rejects(command('addExpense', [1, { ...meal, rp: '1/someone-else.jpg', rt: 'image/jpeg' }]), /Invalid receipt location/);
    await assert.rejects(command('addExpense', [1, { ...meal, rp: '0/file.exe', rt: 'application/octet-stream' }]), /Invalid receipt location/);
    await assert.rejects(command('addExpense', [1, { ...meal, rp: '0/file.jpg', rt: 'text/html' }]), /photo or a PDF/);
    // Non-admins cannot file an expense for someone else: the person field is ignored.
    data = await command('addExpense', [1, { ...meal, ...rc(0, 4), e: 1, notes: 'Tried to file for Pat' }]);
    const tried = data.expenses.find(x => x.notes === 'Tried to file for Pat');
    assert.equal(tried.e, 0);
    data = await command('delExpense', [tried.id]);
    assert.equal(data.expenses.length, 2);
    await assert.rejects(command('approveExpense', [1, true]), /Administrator access required/);

    // Contractors enter their own and see only their own.
    await asUser(contractorUser);
    data = await command('addExpense', [1, { cat: 'baggage', loc: 'Airline', ref: '985-4569', date: '2027-03-02', amt: '35', pay: 'corporate_amex', reimb: false, notes: 'Checked bag', ...rc(1, 5) }]);
    assert.deepEqual(data.expenses.map(x => x.e), [1]);
    await assert.rejects(command('editExpense', [1, { ...meal, ...rc(0, 1) }]), /Access denied/);
    await assert.rejects(command('delExpense', [1]), /Access denied/);

    // Admin sees everyone and approves; approval locks the owner's copy.
    await asUser(admin);
    data = await snapshot();
    assert.equal(data.expenses.length, 3);
    data = await command('approveExpense', [1, true]);
    assert.equal(data.expenses.find(x => x.id === 1).ok, true);
    assert.ok(data.expenses.find(x => x.id === 1).okAt);
    await asUser(staffUser);
    await assert.rejects(command('editExpense', [1, { ...meal, ...rc(0, 1), amt: '99' }]), /approved and can no longer be changed/);
    await assert.rejects(command('delExpense', [1]), /approved/);
    data = await command('editExpense', [2, { cat: 'parking', loc: 'Garage B', ref: 'P-9', date: '2027-03-03', amt: '30.5', pay: 'cash', reimb: true, notes: '', ...rc(0, 2, 'application/pdf') }]);
    await assert.rejects(command('editExpense', [2, { ...meal, rp: null, rt: null }]), /Attach a photo or PDF/, 'a receipt cannot be removed');
    assert.deepEqual([data.expenses.find(x => x.id === 2).loc, Number(data.expenses.find(x => x.id === 2).amt)], ['Garage B', 30.5]);

    // Admin can unapprove, edit, and delete; admins can also enter an expense for someone else.
    await asUser(admin);
    data = await command('approveExpense', [1, false]);
    assert.equal(data.expenses.find(x => x.id === 1).ok, false);
    assert.equal(data.expenses.find(x => x.id === 1).okAt, null);
    data = await command('addExpense', [1, { ...meal, ...rc(1, 6), e: 1, notes: 'Entered by admin' }]);
    assert.ok(data.expenses.some(x => x.e === 1 && x.notes === 'Entered by admin'));
    await assert.rejects(command('addExpense', [1, { ...meal, ...rc(1, 7) }]), /Choose an active person/, 'admin without a roster record must pick a person');

    // Tables are read-only to API callers; others' rows are hidden.
    await asUser(contractorUser);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int n from public.expenses')).rows[0].n, 2);
    await assert.rejects(db.query("update public.expenses set approved = true"), /permission denied/);
    await db.exec('reset role');

    // Other commands still pass through to the earlier command functions.
    await asUser(admin);
    data = await command('addRoom', ['Ballroom', false]);
    assert.equal(data.roomAck.Ballroom, false);
    assert.ok(Array.isArray(data.floorplans) && Array.isArray(data.breaks));
  } finally { await db.close(); }
});
