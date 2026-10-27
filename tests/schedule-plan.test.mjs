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
