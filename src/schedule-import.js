// Run-of-show import: reads the staff schedule spreadsheet in the browser (nothing is uploaded) and plans the event's
// activities. Day headings ("THURSDAY, NOVEMBER 12") set the date for the rows under them; each row is
// Start, Stop, Event (activity), Location (room), Responsibilities (details), Team Lead, Team Members.
// Team members can be names or "All staff" / "All team members"; "All staff" assigns nobody extra, only the
// designated team lead(s). The admin reviews everything before it's saved.
import { readSpreadsheet, matchPerson, listName } from './rooming-import.js';
import { parseTime } from './flight-import.js';

export { readSpreadsheet };
export const DEFAULT_ROOM = 'Wyndham Grand Rio Mar';
export const ALL_DAY = [360, 1320]; // 6:00 AM - 10:00 PM for "Ongoing" or blank times
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const key = h => String(h ?? '').toLowerCase().replace(/[^a-z]/g, '');
const text = v => String(v ?? '').replace(/ /g, ' ').trim();

// "THURSDAY, NOVEMBER 12" or "Thu 11/12" (alone on its row) -> "2026-11-12" in the event's year.
export function dayHeading(cells, year) { return headingDates(cells, year).date; }

// -> {date, alt, text}: alt is the nearest date (within 3 days) that falls on the weekday the heading names, when the
// date itself falls on another weekday ("FRIDAY, NOVEMBER 7" when November 7 is a Saturday -> alt "...-11-06").
const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function headingDates(cells, year) {
  const filled = cells.map(text).filter(Boolean), none = { date: '', alt: null, text: '' };
  if (filled.length !== 1) return none;
  const s = filled[0].toLowerCase();
  let date = '', m = s.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (m) { const mo = MONTHS.findIndex(x => m[2].startsWith(x)); if (mo < 0) return none; date = iso(m[4] ? +m[4] : year, mo + 1, +m[3]); }
  else {
    m = s.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) date = iso(m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : year, +m[2], +m[3]);
  }
  if (!date) return none;
  const said = WEEK.indexOf(m[1]), t = Date.parse(date + 'T00:00:00Z'), actual = new Date(t).getUTCDay();
  let alt = null;
  if (said !== actual) { const diff = ((said - actual + 10) % 7) - 3; alt = new Date(t + diff * 86400000).toISOString().slice(0, 10); }
  return { date, alt, text: filled[0] };
}
const iso = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : ''; };
const minutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Column positions from the header row; falls back to the standard order (Start, Stop, Event, Location,
// Responsibilities, Team Lead, Team Members).
function columns(header) {
  const k = header.map(key), at = (test, dflt) => { const i = k.findIndex(test); return i >= 0 ? i : dflt; };
  return { start: at(x => x === 'start' || x === 'starttime' || x === 'begin', 0), end: at(x => x === 'stop' || x === 'end' || x === 'endtime' || x === 'stoptime', 1),
    title: at(x => x === 'event' || x === 'activity' || x === 'session' || x === 'title', 2), room: at(x => x === 'location' || x === 'room' || x === 'venue', 3),
    det: at(x => x.startsWith('responsib') || x === 'details' || x === 'notes', 4), lead: at(x => x.startsWith('teamlead') || x === 'lead' || x === 'leads', 5),
    members: at(x => x.startsWith('teammember') || x === 'team' || x === 'staff' || x === 'members', 6) };
}
const isHeader = cells => { const k = cells.map(key); return k.includes('start') && (k.includes('stop') || k.includes('end')); };
const ALL = /^(all|all staff|all team( members)?|all members|everyone|all hands)$/i;

// Split "Bre Binder,  Erin Washburn" / "A & B" / lines into names; match each to People.
export function matchNames(raw, people) {
  const s = text(raw);
  if (!s) return { all: false, names: [] };
  if (ALL.test(s)) return { all: true, names: [] };
  const names = s.split(/\s*(?:,|;|\n|&|\band\b|\/)\s*/i).map(x => x.trim()).filter(Boolean);
  return { all: false, names: names.map(n => { if (ALL.test(n)) return { raw: n, all: true };
    const m = matchPerson(listName(n), people);
    return { raw: n, e: m.person ? m.person.id : null, how: m.how, others: m.others }; }) };
}

// -> {items, unmatched (name -> {e, others}), year}. eventStart "2026-11-07". moments: the database accepts
// one-moment actions, so a row with a start and a blank stop is kept at its start time (end = start).
export function planSchedule(rows, people, eventStart, { moments = false } = {}) {
  const year = Number(eventStart.slice(0, 4)), start = Date.parse(eventStart + 'T00:00:00Z');
  let cols = columns([]), date = '', hk = null, sawHeader = false;
  const items = [], headings = [];
  rows.forEach((cells, i) => {
    if (isHeader(cells)) { cols = columns(cells); sawHeader = true; return; }
    const h = headingDates(cells, year);
    // A heading whose weekday and date disagree is listed for the admin to settle; rows go on the named weekday
    // unless they choose the date.
    if (h.date) { hk = h.alt ? 'h' + headings.length : null; if (hk) headings.push({ key: hk, text: h.text, date: h.date, alt: h.alt }); date = h.alt || h.date; return; }
    // First line is the activity name; any further lines ("IF YOU ARE ON THIS LIST BE HERE") go to the top of Details.
    const [title = '', ...extra] = text(cells[cols.title]).split(/\s*\n\s*/).filter(Boolean);
    if (!sawHeader || !title) return; // titles and banners above the table
    const warns = [];
    let a = parseTime(cells[cols.start]), b = parseTime(cells[cols.end]), allDay = false;
    if (moments && a && !b && !text(cells[cols.end])) b = a;
    if (!a || !b) { allDay = true; warns.push((text(cells[cols.start]) || 'No time') + ': scheduled all day (6:00 AM–10:00 PM); check the times'); }
    let s = allDay ? ALL_DAY[0] : minutes(a), e = allDay ? ALL_DAY[1] : minutes(b);
    if (!allDay && (e < s || (e === s && !moments))) { if (e === 0) e = 1440; else warns.push('Stop time is before the start time'); }
    const day = date ? Math.round((Date.parse(date + 'T00:00:00Z') - start) / 86400000) : null;
    const roomRaw = text(cells[cols.room]);
    const lead = matchNames(cells[cols.lead], people), mem = matchNames(cells[cols.members], people);
    items.push({ line: i + 1, hk, date, day, title, room: roomRaw || DEFAULT_ROOM, roomDefault: !roomRaw, start: s, end: e, allDay,
      det: [...extra, text(cells[cols.det])].filter(Boolean).join('\n').slice(0, 2000), leadNames: lead.names.filter(n => !n.all), memberNames: mem.names.filter(n => !n.all),
      all: mem.all || lead.all || mem.names.some(n => n.all), warns, skip: false });
  });
  // Every distinct name not matched exactly, for one decision each in the review.
  const unmatched = {};
  for (const it of items) for (const n of [...it.leadNames, ...it.memberNames]) if (n.how !== 'exact') {
    const k = n.raw.toLowerCase();
    if (!unmatched[k]) unmatched[k] = { raw: n.raw, e: n.e, how: n.how, others: n.others, rows: 0 };
    unmatched[k].rows++;
  }
  return { items, unmatched, year, headings };
}

// A row's date and day index once the admin has settled a mismatched heading (use: 'weekday' or 'date').
export function withHeading(it, headings, use, eventStart) {
  const h = it.hk && headings.find(x => x.key === it.hk);
  if (!h) return it;
  const date = use[h.key] === 'date' ? h.date : h.alt;
  return { ...it, date, day: Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(eventStart + 'T00:00:00Z')) / 86400000) };
}

// People ids for a row, applying the admin's choices for unmatched names. "All staff" adds nobody: only the
// team lead(s) and any members named alongside it are assigned.
export function rowPeople(it, choice) {
  const pick = n => n.how === 'exact' ? n.e : choice[n.raw.toLowerCase()] ?? null;
  const leads = [...new Set(it.leadNames.map(pick).filter(x => x != null))];
  const members = [...new Set([...it.memberNames.map(pick).filter(x => x != null)])];
  return { leads, members };
}

// Which existing activity each row updates, as the database does it: same day and name; when a name repeats on a
// day ("General Session" at 8:30 and 9:00), each row takes its own, preferring the same start time.
export function pairExisting(items, existing) {
  const used = new Set();
  return items.map(it => {
    if (it.skip || it.day == null) return null;
    const c = existing.filter(x => !used.has(x.id) && x.d === it.day && x.t.trim().toLowerCase() === it.title.toLowerCase())
      .sort((x, y) => (y.a === it.start) - (x.a === it.start) || x.a - y.a || x.id - y.id)[0] || null;
    if (c) used.add(c.id);
    return c;
  });
}

// What saving a row would do. existing: activities of this event [{id, t, d, a, b, r, det}]; asg [{s, e, lead}].
// old: the activity this row updates (from pairExisting); left out, it is looked up by day and name.
export function scheduleEffect(it, existing, asg, days, people, old) {
  if (it.skip) return { kind: 'skip', text: 'Skipped' };
  if (it.day == null) return { kind: 'error', text: 'No day heading above this row' };
  if (it.day < 0) return { kind: 'error', text: 'Before the event starts' };
  if (it.day >= days) return { kind: 'extend', text: 'After the event ends: extend the event to import it' };
  if (old === undefined) old = existing.find(x => x.d === it.day && x.t.trim().toLowerCase() === it.title.toLowerCase()) || null;
  if (!old) return { kind: 'new', text: 'New activity' };
  const ch = [], team = new Set(asg.filter(a => a.s === old.id).map(a => a.e)), want = new Set([...people.leads, ...people.members]);
  if (old.a !== it.start || old.b !== it.end) ch.push('time');
  if (old.r.toLowerCase() !== it.room.toLowerCase()) ch.push('room');
  if ((old.det || '') !== it.det) ch.push('details');
  if (team.size !== want.size || [...want].some(e => !team.has(e))) ch.push('team');
  const leadsNow = new Set(asg.filter(a => a.s === old.id && a.lead).map(a => a.e));
  if (leadsNow.size !== people.leads.length || people.leads.some(e => !leadsNow.has(e))) ch.push('leads');
  return ch.length ? { kind: 'update', text: 'Updates ' + ch.join(', ') } : { kind: 'same', text: 'No change' };
}
