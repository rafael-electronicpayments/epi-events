import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupport, timeRange, roleLabel, planSupport, supportRow, supportEffects, supportSheet } from '../src/session-support.js';

test('Session Support workbook rows become cards with grouped people', () => {
  assert.deepEqual(timeRange('9:00 AM - 10:30 AM'), [540, 630]);
  assert.deepEqual(timeRange('1:40 PM - 3:30 PM '), [820, 930]);
  assert.deepEqual(timeRange('1:40 - 2:30 PM'), [820, 870]);
  assert.equal(roleLabel('Moderators and Q&A Mics'), 'Moderators / Q&A mics');
  assert.equal(roleLabel('Notetakers'), 'Notetaker');
  assert.equal(roleLabel('Additional help with doors'), 'Help with doors');
  assert.deepEqual(parseSupport('Q&A Mics: \nKeith Ashcraft/Nikki Montague\n\nNotetakers: \nMichelle Richter\nNotes & Pull Quotes: Christina Verity/Jen Fontana'),
    [{ label: 'Q&A mics', box: 'md', names: ['Keith Ashcraft', 'Nikki Montague'] }, { label: 'Notetaker', box: 'nt', names: ['Michelle Richter'] },
      { label: 'Notes & pull quotes', box: 'nt', names: ['Christina Verity', 'Jen Fontana'] }]);
  assert.deepEqual(parseSupport('Notetakers: \nNotes & Pull Quotes: Christina Verity/Jen Fontana').map(g => g.label), ['Notes & pull quotes'], 'empty group dropped');

  const people = [{ id: 0, name: 'Michelle Richter' }, { id: 1, name: 'Keith Ashcraft' }];
  const sheet = { sheet: 'DAY 1', rows: [['IMPACT26 SESSION SUPPORT - DAY 1'], ['TUESDAY, NOVEMBER 10'], ['GENERAL SESSION'],
    ['Time', 'Location', 'Presentation ', '', 'Speaker(s)', 'Team Leads'],
    ['9:00 AM - 10:30 AM', 'Rio Mar 5 & 6', 'Keynote Address', '', 'Michael Nardy, CEO', 'Q&A Mics: \nKeith Ashcraft\n\nNotetakers: \nMichelle Richter\nMystery Person'],
    ['10:45 AM - 11:00 AM', 'Rio Mar 5 & 6', 'BREAK'],
    ['GENERAL SESSION\nKEYNOTE ADDRESS'], ['Time', 'Location', 'Presentation ', '', 'Speaker(s)', 'Team Leads'],
    ['1:40 PM - 3:30 PM ', 'Rio Mar 5 & 6', 'Rio Mar 5 & 6', 'Keynote Address: Get Your Degree in Sales ', 'Jason Evans \nPower Sales University ', 'Notetakers: Michelle Richter'],
    ['BREAKOUTS \n11:00 AM - 12:30 PM'], ['Track', 'Time ', 'Location', 'Presentation', 'Speaker(s)', 'Team Leads'],
    ['Breakout 1\n(General Session Room)', '11:00 AM - 12:30 PM', 'Rio Mar 5 & 6', 'TableTurn 101', 'Steve Messemer', 'Moderators/Q&A Mics: Keith Ashcraft'],
    ['LUNCH ', '12:30 PM - 1:30 PM', 'Rio Mar 7-10', 'LUNCH', '', '12:20 PM & 12:30 PM \nLast Call: Bre Binder/Erin Washburn']] };
  const p = planSupport([sheet], people, '2026-11-05');
  assert.deepEqual(p.items.map(x => [x.day, x.a, x.b, x.blk, x.trk, x.t, x.brk]), [
    [5, 540, 630, 'General Session', '', 'Keynote Address', false], [5, 645, 660, 'General Session', '', 'Break', true],
    [5, 820, 930, 'General Session · Keynote Address', '', 'Keynote Address: Get Your Degree in Sales', false],
    [5, 660, 750, 'Breakouts · 11:00 AM–12:30 PM', 'Breakout 1 (General Session Room)', 'TableTurn 101', false],
    [5, 750, 810, 'Breakouts · 11:00 AM–12:30 PM', '', 'Lunch', true]]);
  assert.equal(p.items[4].note, '12:20 PM & 12:30 PM · Last Call: Bre Binder/Erin Washburn');
  assert.equal(p.items[2].sp, 'Jason Evans\nPower Sales University');
  assert.deepEqual(Object.keys(p.unmatched), ['mystery person']);
  const row = supportRow(p.items[0], { 'mystery person': 1 });
  assert.deepEqual(row.ppl, [{ box: 'md', role: 'Q&A mics', e: 1 }, { box: 'nt', role: 'Notetaker', e: 0 }, { box: 'nt', role: 'Notetaker', e: 1 }]);
  assert.deepEqual(supportRow(p.items[3], {}).roles, [{ box: 'md', label: 'Moderators / Q&A mics' }, { box: 'nt', label: 'Notetaker' }], 'empty box gets the default group');
  const fx = supportEffects(p.items, [{ id: 7, d: 5, a: 540, t: 'Keynote address' }], 9);
  assert.deepEqual(fx.map(f => f.kind), ['update', 'new', 'new', 'new', 'new']);
  const xl = supportSheet([{ d: 5, a: 540, b: 630, blk: 'GS', trk: '', t: 'Keynote', r: 'Rio Mar', sp: '', brk: false, roles: [], ppl: [{ box: 'nt', role: 'Notetaker', e: 0, n: 'Michelle Richter' }], ntn: 'Quotes', mdn: '' }], { start: '2026-11-05', name: 'IMPACT26' });
  assert.deepEqual(xl[1].slice(0, 3).concat(xl[1].slice(8, 10)), ['Tue, Nov 10', '9:00 AM', '10:30 AM', 'Notetaker: Michelle Richter', 'Quotes']);
});
