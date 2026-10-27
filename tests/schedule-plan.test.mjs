import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchedule, rowPeople, scheduleEffect } from '../src/schedule-import.js';

test('"All staff" in Team Members assigns only the designated team lead', () => {
  const people = [{ id: 0, name: 'Alex Rivera' }, { id: 1, name: 'Sam Lee' }, { id: 2, name: 'Casey Moore' }];
  const rows = [['Start', 'Stop', 'Event', 'Location', 'Responsibilities', 'Team Lead', 'Team Members'],
    ['FRIDAY, NOVEMBER 13'],
    ['8:30 AM', '10:00 AM', 'Staff Breakfast', 'San Cristobal', '', 'Sam Lee', 'All Staff'],
    ['10:00 AM', '11:00 AM', 'Staff Hospitality', '', '', '', 'All team members'],
    ['11:00 AM', '12:00 PM', 'Pack Up', '', '', 'Alex Rivera', 'Casey Moore']];
  const { items } = planSchedule(rows, people, '2026-11-07');
  const [breakfast, hosp, pack] = items.map(it => rowPeople(it, {}));
  assert.equal(items[0].all, true);
  assert.deepEqual(breakfast, { leads: [1], members: [] });
  assert.deepEqual(hosp, { leads: [], members: [] });
  assert.deepEqual(pack, { leads: [0], members: [2] });
  assert.equal(scheduleEffect(items[0], [], [], 7, breakfast).text, 'New activity');
});

test('a row with a start and no stop becomes a one-moment action when the database supports it', () => {
  const rows = [['Start', 'Stop', 'Event', 'Location', 'Responsibilities', 'Team Lead', 'Team Members'],
    ['FRIDAY, NOVEMBER 13'], ['9:00 AM', '', 'Close event hall doors', 'Event Hall', '', '', '']];
  const now = planSchedule(rows, [], '2026-11-07', { moments: true }).items[0];
  assert.deepEqual([now.start, now.end, now.allDay, now.warns], [540, 540, false, []]);
  const old = planSchedule(rows, [], '2026-11-07').items[0];
  assert.equal(old.allDay, true, 'older databases still get the all-day fallback');
});

test('headings whose weekday and date disagree are flagged and placed on the named weekday by default', async () => {
  const { withHeading, pairExisting } = await import('../src/schedule-import.js');
  const rows = [['Start', 'Stop', 'Event', 'Location', 'Responsibilities', 'Team Lead', 'Team Members'],
    ['THURSDAY, NOVEMBER 6'], ['2:00 PM', '11:00 PM', 'Team Arrivals', '', '', '', ''],
    ['FRIDAY, NOVEMBER 7'], ['8:00 AM', '9:00 AM', 'Breakfast', '', '', '', ''],
    ['WEDNESDAY, NOVEMBER 11'], ['8:30 AM', '9:00 AM', 'General Session', '', '', '', ''], ['9:00 AM', '11:30 AM', 'General Session', '', '', '', '']];
  const p = planSchedule(rows, [], '2026-11-05', { moments: true });
  assert.deepEqual(p.headings.map(h => [h.text, h.date, h.alt]), [['THURSDAY, NOVEMBER 6', '2026-11-06', '2026-11-05'], ['FRIDAY, NOVEMBER 7', '2026-11-07', '2026-11-06']]);
  assert.deepEqual(p.items.map(x => [x.title, x.date, x.day]), [['Team Arrivals', '2026-11-05', 0], ['Breakfast', '2026-11-06', 1], ['General Session', '2026-11-11', 6], ['General Session', '2026-11-11', 6]]);
  const asDate = withHeading(p.items[1], p.headings, { [p.headings[1].key]: 'date' }, '2026-11-05');
  assert.deepEqual([asDate.date, asDate.day], ['2026-11-07', 2]);
  // Repeated names on a day pair with separate activities, preferring the same start.
  const existing = [{ id: 9, t: 'General Session', d: 6, a: 540 }, { id: 8, t: 'General Session', d: 6, a: 510 }];
  assert.deepEqual(pairExisting(p.items, existing).map(x => x && x.id), [null, null, 8, 9]);
});
