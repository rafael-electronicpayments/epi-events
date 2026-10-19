import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, mapColumns, splitName, cleanPhone, planImport, unzip } from '../src/people-import.js';

// All data here is synthetic.
const people = [
  { id: 0, name: 'Dana Lee', email: 'dana@example.test', role: 'Room Host', acct: 'staff', phone: '555-010-0001', map: 1, gone: 0 },
  { id: 1, name: 'Sam Ortiz', email: '', role: 'Lead', acct: 'staff', phone: '', map: 0, gone: 0 },
  { id: 2, name: 'Gone Person', email: 'gone@example.test', role: '', acct: 'staff', phone: '', map: 0, gone: 1 }
];

test('maps spreadsheet headers by meaning', () => {
  assert.deepEqual(mapColumns(['Staff Name', 'Email Address', 'Company Name', 'Mobile Phone Number', 'Type']),
    { name: 0, email: 1, phone: 3, type: 4, title: -1 });
  assert.equal(mapColumns(['Name', 'Role or title']).title, 1);
});

test('splits run-together names and normalizes phones', () => {
  assert.deepEqual(splitName('DanaLee'), { name: 'Dana Lee', split: true });
  assert.deepEqual(splitName('JJAbrams'), { name: 'JJ Abrams', split: true });
  assert.deepEqual(splitName('  Mary  Ann Lee '), { name: 'Mary Ann Lee', split: false });
  assert.deepEqual(cleanPhone('5550100002'), { phone: '555-010-0002', ok: true });
  assert.deepEqual(cleanPhone('1 (555) 010-0003'), { phone: '555-010-0003', ok: true });
  assert.equal(cleanPhone('35550100004').ok, false);
  assert.equal(cleanPhone('').ok, true);
});

test('parses quoted CSV', () => {
  assert.deepEqual(parseCsv('﻿Name,Email\r\n"Lee, Dana",d@example.test\n\n"Say ""hi""",\n'),
    [['Name', 'Email'], ['Lee, Dana', 'd@example.test'], ['Say "hi"', '']]);
});

test('plans new, updated, unchanged, and invalid rows', () => {
  const rows = [
    ['Staff Name', 'Email Address', 'Mobile Phone Number', 'Type'],
    ['DanaLee', 'DANA@example.test', '5550100001', 'Staff'],
    ['SamOrtiz', 'sam@example.test', '5550100005', 'Admin'],
    ['NewPerson', 'new@example.test', '35550100004', 'Volunteer'],
    ['Bad Email', 'not-an-email', '', 'Staff'],
    ['Repeat', 'new@example.test', '', 'Staff'],
    ['GonePerson', 'gone@example.test', '', 'Staff']
  ];
  const plan = planImport(rows, people);
  assert.deepEqual(plan.map(r => r.status), ['same', 'update', 'new', 'error', 'error', 'new']);
  assert.equal(plan[0].id, 0);
  assert.equal(plan[0].include, false);
  assert.equal(plan[1].id, 1, 'matched by name when the person has no email');
  assert.deepEqual(plan[1].changes, ['email', 'type', 'phone']);
  assert.ok(plan[1].notes.includes('Gets full administrator access'));
  assert.equal(plan[1].person.r, 'Lead', 'keeps existing title when the file has none');
  assert.equal(plan[2].person.acct, 'staff');
  assert.ok(plan[2].notes.some(n => n.startsWith('Unknown type')));
  assert.ok(plan[2].notes.includes('Check phone number'));
  assert.deepEqual(plan[3].errors, ['Invalid email']);
  assert.deepEqual(plan[4].errors, ['Email repeated in file']);
  assert.equal(plan[5].id, null, 'archived people are not matched');
  assert.throws(() => planImport([['Email'], ['a@example.test']], people), /No name column/);
});

test('reads stored ZIP entries', async () => {
  const enc = new TextEncoder(), name = enc.encode('xl/workbook.xml'), body = enc.encode('<workbook/>');
  const local = new Uint8Array(30 + name.length + body.length), lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint32(18, body.length, true); lv.setUint32(22, body.length, true); lv.setUint16(26, name.length, true);
  local.set(name, 30); local.set(body, 30 + name.length);
  const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, body.length, true); cv.setUint32(24, body.length, true); cv.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, central.length, true); ev.setUint32(16, local.length, true);
  const zip = new Uint8Array([...local, ...central, ...end]);
  assert.deepEqual(await unzip(zip.buffer, () => true), { 'xl/workbook.xml': '<workbook/>' });
  await assert.rejects(unzip(new Uint8Array(40).buffer, () => true), /not a valid Excel/);
});
