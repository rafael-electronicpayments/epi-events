// Flights manifest import: reads the travel spreadsheet in the browser (nothing is uploaded), matches each row to
// People by email (then by name), and plans what changes. The admin reviews every row before anything is saved.
// Expected columns (by meaning): Last Name, First Name, Email, Solo rider / VIP private, Arrival Date, Flight #,
// Landing Time, Departure Date, Flight #, Departure Time. The first Flight # after Arrival Date is the arriving
// flight; the one after Departure Date is the departing flight. Dates may omit the year ("Fri. 11/6").
import { readSpreadsheet, matchPerson } from './rooming-import.js';

export { readSpreadsheet };
const key = h => String(h).toLowerCase().replace(/[^a-z]/g, '');
// Airline codes and names as people write them -> carrier name as the app lists it; international carriers marked.
const AIRLINES = [['AA', 'American Airlines', /american/], ['DL', 'Delta Air Lines', /delta/], ['UA', 'United Airlines', /united/], ['WN', 'Southwest Airlines', /southwest/],
  ['B6', 'JetBlue Airways', /jet ?blue/], ['AS', 'Alaska Airlines', /alaska/], ['NK', 'Spirit Airlines', /spirit/], ['F9', 'Frontier Airlines', /frontier/],
  ['HA', 'Hawaiian Airlines', /hawaiian/], ['G4', 'Allegiant Air', /allegiant/], ['SY', 'Sun Country Airlines', /sun country/], ['MX', 'Breeze Airways', /breeze/],
  ['XP', 'Avelo Airlines', /avelo/], ['AC', 'Air Canada', /air canada/, 1], ['WS', 'WestJet', /westjet/, 1], ['PD', 'Porter Airlines', /porter/, 1],
  ['CM', 'Copa Airlines', /copa/, 1], ['AM', 'Aeromexico', /aeromexico|aeroméxico/, 1], ['BA', 'British Airways', /british/, 1], ['LH', 'Lufthansa', /lufthansa/, 1],
  ['IB', 'Iberia', /iberia/, 1], ['AF', 'Air France', /air france/, 1], ['KL', 'KLM', /\bklm\b/, 1], ['VS', 'Virgin Atlantic', /virgin/, 1], ['TP', 'TAP Air Portugal', /\btap\b/, 1]];
const byCode = Object.fromEntries(AIRLINES.map(a => [a[0], a]));

// "IB381, Iberia" -> {flight:"IB 381", carrier:"Iberia"}; "UA1889 & UA1339" -> "UA 1889 & UA 1339";
// "Delta 1913, 565, 1185" -> "DL 1913 & DL 565 & DL 1185". The first leg's airline is used for a departure, the last's for an arrival.
export function parseFlight(raw, arriving) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^(n\/?a|none|tbd|-+)$/i.test(s)) return { flight: '', carrier: '', intl: false, legs: [] };
  const named = AIRLINES.find(a => a[2].test(s.toLowerCase()));
  const legs = []; let code = named ? named[0] : null;
  // An airline code has at least one letter (AA, B6, 9K); a bare number uses the airline named or coded before it.
  for (const m of s.matchAll(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b|\b(\d{1,4})\b/gi)) {
    if (m[1] && byCode[m[1].toUpperCase()] || (m[1] && !named)) { code = m[1].toUpperCase(); legs.push([code, m[2]]); }
    else if (m[1] && named) legs.push([named[0], m[2]]);
    else if (m[3] && code) legs.push([code, m[3]]);
  }
  if (!legs.length) return { flight: s.slice(0, 60).toUpperCase(), carrier: named ? named[1] : '', intl: !!(named && named[3]), legs: [], unread: true };
  const flight = legs.map(([c, n]) => c + ' ' + n).join(' & ').slice(0, 60);
  const lead = arriving ? legs[legs.length - 1][0] : legs[0][0], a = byCode[lead] || named;
  return { flight, carrier: a ? a[1] : lead, intl: legs.some(([c]) => byCode[c]?.[3]), legs };
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// "Fri. 11/6", "11/6/2026", "2026-11-06", or an Excel day number -> {date:"2026-11-06", warn}; the year defaults to the event's.
export function parseDay(v, year) {
  const s = String(v ?? '').trim();
  if (!s) return { date: '' };
  if (/^\d{5}(\.\d+)?$/.test(s)) return { date: new Date(Math.round((Number(s) - 25569) * 86400000)).toISOString().slice(0, 10) };
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/), y, mo, d;
  if (m) [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  else if ((m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) { mo = +m[1]; d = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year; }
  else return { date: '', warn: 'Couldn\'t read the date "' + s + '"' };
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return { date: '', warn: 'Couldn\'t read the date "' + s + '"' };
  const date = dt.toISOString().slice(0, 10), said = s.toLowerCase().match(/^(sun|mon|tue|wed|thu|fri|sat)/);
  return { date, warn: said && DOW[dt.getUTCDay()] !== said[1] ? '"' + s + '" isn\'t a ' + s.slice(0, 3) + ' in ' + y + ' (it\'s a ' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getUTCDay()] + '); check the date' : '' };
}
// Excel time fraction (0.694…), "16:40", "4:40 PM", or "16:40:00" -> "16:40".
export function parseTime(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^0?\.\d+$|^[01](\.0+)?$/.test(s) && Number(s) < 1) { const mins = Math.round(Number(s) * 1440); return String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (!m) return '';
  let h = +m[1]; const ap = m[3]?.[0]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
  return h < 24 && +m[2] < 60 ? String(h).padStart(2, '0') + ':' + m[2] : '';
}

export function mapFlightColumns(header) {
  const keys = header.map(key), find = (test, from = 0) => { for (let i = from; i < keys.length; i++) if (test(keys[i])) return i; return -1; };
  const inDate = find(k => k.startsWith('arrival') || k === 'arrive' || k === 'arrivaldate'), outDate = find(k => k.startsWith('departure') && !k.includes('time') || k === 'departdate');
  const flightAfter = i => i < 0 ? -1 : find(k => k.startsWith('flight'), i + 1);
  return { last: find(k => k === 'lastname' || k === 'surname'), first: find(k => k === 'firstname' || k === 'givenname'), name: find(k => k === 'name' || k === 'fullname'),
    email: find(k => k.includes('email')), vip: find(k => k.includes('vip') || k.includes('solo') || k.includes('private')),
    inDate, inFlight: flightAfter(inDate), inTime: find(k => k.includes('landing') || k === 'arrivaltime' || k === 'arrivetime'),
    outDate, outFlight: flightAfter(outDate), outTime: find(k => k === 'departuretime' || k === 'departtime' || k.includes('takeoff')) };
}

export function planFlights(rows, people, year) {
  if (!rows.length) throw new Error('The file is empty.');
  const c = mapFlightColumns(rows[0]);
  if ((c.last < 0 || c.first < 0) && c.name < 0) throw new Error('This doesn\'t look like a flights list: it needs Last Name and First Name (or Name) columns.');
  if (c.inDate < 0 && c.outDate < 0) throw new Error('This doesn\'t look like a flights list: it needs Arrival Date or Departure Date columns.');
  const cell = (r, k) => c[k] >= 0 ? r[c[k]] ?? '' : '';
  const emailOf = p => String(p.email || '').trim().toLowerCase();
  return rows.slice(1).map((r, i) => {
    const last = String(cell(r, 'last')).trim(), first = String(cell(r, 'first')).trim(), whole = String(cell(r, 'name')).trim();
    const display = whole || [first, last].filter(Boolean).join(' ');
    if (!display) return null;
    const email = String(cell(r, 'email')).trim().toLowerCase();
    let person = email ? people.find(p => p && !p.gone && emailOf(p) === email) : null, how = person ? 'email' : null, others = [];
    if (!person) { const m = matchPerson(whole && !last ? whole : last + ',' + first, people); person = m.person; how = m.how; others = m.others; }
    const inF = parseFlight(cell(r, 'inFlight'), true), outF = parseFlight(cell(r, 'outFlight'), false);
    const inD = parseDay(cell(r, 'inDate'), year), outD = parseDay(cell(r, 'outDate'), year), inT = parseTime(cell(r, 'inTime')), outT = parseTime(cell(r, 'outTime'));
    const warns = [inD.warn, outD.warn].filter(Boolean);
    if (inF.unread) warns.push('Couldn\'t read the arriving flight number');
    if (outF.unread) warns.push('Couldn\'t read the departing flight number');
    if (inD.date && !inT) warns.push('No landing time'); if (outD.date && !outT) warns.push('No departure time');
    return { line: i + 2, name: display, email, e: person ? person.id : null, how, others, vip: /^(y|yes|x|true|vip|1)$/i.test(String(cell(r, 'vip')).trim()),
      inCarrier: inF.carrier, inFlight: inF.flight, inArrive: inD.date && inT ? inD.date + 'T' + inT : '',
      outCarrier: outF.carrier, outFlight: outF.flight, outDepart: outD.date && outT ? outD.date + 'T' + outT : '', intl: inF.intl || outF.intl, warns };
  }).filter(Boolean);
}

export function flightEffect(it, flights, hotels) {
  if (it.e == null) return { kind: 'skip', text: 'Skipped: choose a person' };
  if (!it.inArrive && !it.outDepart) return { kind: 'error', text: 'No arrival or departure time' };
  if (it.inArrive && it.outDepart && it.outDepart <= it.inArrive) return { kind: 'error', text: 'Departure is before arrival: check the dates' };
  const f = flights.find(x => x.e === it.e), h = hotels.find(x => x.e === it.e);
  const car = it.vip ? (h ? (h.tIn === 'car' && h.tOut === 'car' ? '' : '; car service both ways') : '; VIP: add their hotel, then set car service') : '';
  if (!f) return { kind: 'new', text: 'New flight' + car };
  const ch = [];
  if ((f.inFlight || '') !== it.inFlight || (f.inArrive || '') !== it.inArrive) ch.push('arrival');
  if ((f.outFlight || '') !== it.outFlight || (f.outDepart || '') !== it.outDepart) ch.push('departure');
  if ((f.inCarrier || '') !== it.inCarrier || (f.outCarrier || '') !== it.outCarrier) ch.push('carrier');
  if (!!f.intl !== !!it.intl) ch.push(it.intl ? 'marked international' : 'not international');
  return ch.length ? { kind: 'update', text: 'Updates ' + ch.join(', ') + car } : car ? { kind: 'update', text: 'No flight change' + car } : { kind: 'same', text: 'No change' };
}
