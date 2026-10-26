// Venue hotel rooming list import: reads the spreadsheet in the browser (nothing is uploaded), matches each
// name to People, and plans what changes. The admin reviews every row before anything is saved.
// Expected columns (by meaning, any order): Status, Confirmation #, Full Name ("Last,First"),
// Accompanying Names, Arrival, Departure; Adults/Children/Nights are read but not stored.
import { readSpreadsheet } from './people-import.js';

export { readSpreadsheet };
const key = h => String(h).toLowerCase().replace(/[^a-z]/g, '');
export function mapRoomingColumns(header) {
  const keys = header.map(key), find = test => keys.findIndex(test);
  return {
    status: find(k => k === 'status' || k.endsWith('status')),
    conf: find(k => k.includes('confirmation') || k === 'conf' || k === 'confno' || k.includes('reservationnumber')),
    name: find(k => (k.includes('name') && !k.includes('accompan') && !k.includes('sharer') && !k.includes('hotel')) || k === 'guest' || k === 'guestname'),
    companion: find(k => k.includes('accompan') || k.includes('sharer') || k.includes('sharewith') || k.includes('additionalguest')),
    in: find(k => k.startsWith('arriv') || k === 'checkin'),
    out: find(k => k.startsWith('depart') || k === 'checkout'),
    nights: find(k => k === 'nights' || k === 'roomnights'),
    adults: find(k => k === 'adults')
  };
}

// Excel stores dates as day numbers; CSVs use text such as 11/7/2026 or 2026-11-07.
export function sheetDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((Number(s) - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return '';
}
// Confirmation numbers can come through as numbers ("5615312" or "5615312.0").
const confText = v => String(v ?? '').trim().replace(/\.0+$/, '');

// Names: "Last,First" or "Last, First Middle" on the list; "First Last" in People.
const SUFFIX = /^(jr|sr|ii|iii|iv)$/;
const clean = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
export function listName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const [last, first] = s.includes(',') ? [s.slice(0, s.indexOf(',')), s.slice(s.indexOf(',') + 1)] : [s.split(' ').slice(-1)[0], s.split(' ').slice(0, -1).join(' ')];
  const lastWords = clean(last).split(/[\s-]+/).filter(w => w && !SUFFIX.test(w)), firstWords = clean(first).split(/[\s-]+/).filter(w => w && !SUFFIX.test(w));
  const display = [first.trim(), last.trim()].filter(Boolean).join(' ');
  return { first: firstWords[0] || '', last: lastWords.join(''), display, raw: s };
}
function personName(p) {
  const words = clean(p.name).split(/\s+/).filter(w => !SUFFIX.test(w.replace(/,/g, '')));
  return { first: (words[0] || '').replace(/-/g, ''), lastWords: words.slice(1).map(w => w.replace(/[-,]/g, '')) };
}
const NICK = [['mike', 'michael'], ['matt', 'matthew'], ['nick', 'nicholas', 'nicolas'], ['chris', 'christopher', 'christina', 'christian', 'christine', 'kristine', 'kris'],
  ['kat', 'kathryn', 'katherine', 'kate', 'katie', 'cat', 'catherine'], ['bre', 'breanna', 'brianna', 'bree'], ['jen', 'jenn', 'jennifer', 'jenny'],
  ['zach', 'zachary', 'zack'], ['pat', 'patrick', 'patricia'], ['andy', 'andrew', 'drew'], ['rob', 'robert', 'bob', 'bobby', 'robbie'],
  ['dave', 'david'], ['jon', 'jonathan', 'john', 'johnny'], ['steve', 'steven', 'stephen'], ['tom', 'thomas', 'tommy'], ['will', 'william', 'bill', 'billy'],
  ['jim', 'james', 'jimmy'], ['ed', 'edwin', 'edward', 'eddie'], ['sandy', 'sandra'], ['nikki', 'nicole'], ['alex', 'alexander', 'alexandra'],
  ['sam', 'samuel', 'samantha'], ['ben', 'benjamin'], ['dan', 'daniel', 'danny'], ['tony', 'anthony'], ['joe', 'joseph'], ['liz', 'elizabeth', 'beth'],
  ['meg', 'megan', 'meghan'], ['ron', 'ronald', 'ronnie'], ['kay', 'kaye'], ['jody', 'joseph', 'joanna'], ['akira', 'aki']];
const sameFirst = (a, b) => a === b || (a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a))) || NICK.some(g => g.includes(a) && g.includes(b));

// Best match in People: { person, how: 'exact' | 'close' | null, others: [people with the same last name] }.
export function matchPerson(raw, people) {
  const n = typeof raw === 'string' ? listName(raw) : raw;
  if (!n || !n.last) return { person: null, how: null, others: [] };
  const pool = people.filter(p => p && !p.gone).map(p => ({ p, ...personName(p) }));
  const lastHit = x => x.lastWords.join('') === n.last || x.lastWords.slice(-1)[0] === n.last || (x.lastWords.length > 1 && x.lastWords.join('').endsWith(n.last));
  const sameLast = pool.filter(lastHit);
  const exact = sameLast.filter(x => x.first === n.first);
  if (exact.length === 1) return { person: exact[0].p, how: 'exact', others: sameLast.map(x => x.p) };
  const close = sameLast.filter(x => sameFirst(x.first, n.first) || (n.first && x.first[0] === n.first[0] && n.first.length <= 2));
  if (close.length === 1) return { person: close[0].p, how: 'close', others: sameLast.map(x => x.p) };
  return { person: null, how: null, others: sameLast.map(x => x.p) };
}

// Turn sheet rows into a plan. hotels: the event's existing bookings.
export function planRooming(rows, people, hotels) {
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0], cols = mapRoomingColumns(header);
  if (cols.name < 0 || cols.in < 0 || cols.out < 0) throw new Error('This doesn\'t look like a rooming list: it needs Full Name, Arrival, and Departure columns.');
  const cell = (r, k) => cols[k] >= 0 ? r[cols[k]] ?? '' : '';
  const items = rows.slice(1).map((r, i) => {
    const n = listName(cell(r, 'name')), comp = listName(cell(r, 'companion')), status = String(cell(r, 'status')).trim();
    const m = n ? matchPerson(n, people) : { person: null, how: null, others: [] };
    const cm = comp ? matchPerson(comp, people) : { person: null, how: null, others: [] };
    return { line: i + 2, name: n, status, reserved: !status || /reserv|confirm|definite|booked|guaranteed/i.test(status), conf: confText(cell(r, 'conf')),
      in: sheetDate(cell(r, 'in')), out: sheetDate(cell(r, 'out')), companion: comp, e: m.person ? m.person.id : null, how: m.how, others: m.others,
      ce: cm.person && cm.how === 'exact' ? cm.person.id : null, ceSuggest: cm.person ? cm.person.id : null, ceHow: cm.how };
  }).filter(x => x.name);
  return { items, cols };
}

// What saving a row would do, given the current choices.
export function rowEffect(it, hotels, people) {
  if (!it.reserved) { const h = it.e != null && hotels.find(x => x.e === it.e); return h ? { kind: 'cancelled-has', text: 'Not imported (' + (it.status || 'not reserved') + '). Has a booking' } : { kind: 'cancelled', text: 'Not imported (' + (it.status || 'not reserved') + ')' }; }
  if (it.e == null) return { kind: 'skip', text: 'Skipped: choose a person' };
  if (!it.in || !it.out || it.out <= it.in) return { kind: 'error', text: 'Check the arrival and departure dates' };
  const h = hotels.find(x => x.e === it.e), comp = it.companion ? (it.ce != null ? people[it.ce]?.name : it.companion.display) : '';
  if (!h) return { kind: 'new', text: 'New booking' + (it.ce != null ? '; shared with ' + comp : '') };
  const ch = [];
  if ((h.conf || '') !== it.conf) ch.push('confirmation ' + (h.conf || '–') + ' → ' + (it.conf || '–'));
  if (h.in !== it.in || h.out !== it.out) ch.push('dates');
  if ((h.companionId ?? null) !== (it.ce ?? null) || (it.ce == null && (h.companion || '') !== (it.companion?.display || ''))) ch.push(comp ? 'accompanying: ' + comp : 'accompanying removed');
  return ch.length ? { kind: 'update', text: 'Updates ' + ch.join(', ') } : { kind: 'same', text: 'No change' };
}
