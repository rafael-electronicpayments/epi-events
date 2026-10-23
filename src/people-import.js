// Reads a roster spreadsheet (.xlsx or .csv) in the browser and turns it into People changes.
// Nothing is uploaded: the file is parsed locally and only the chosen rows are saved, one person at a time.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal ZIP reader (central directory), enough for .xlsx packages.
export async function unzip(buffer, wanted) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This file is not a valid Excel workbook.');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const files = {}, text = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('This Excel workbook appears to be damaged.');
    const method = view.getUint16(p + 10, true), size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true), name = text.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extra + comment;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error('This Excel workbook uses an unsupported compression format.');
    files[name] = text.decode(method === 8 ? await inflate(data) : data);
  }
  return files;
}

const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const colIndex = ref => { let n = 0; for (const c of ref.replace(/\d+$/, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

async function readXlsx(buffer, parseXml) {
  const files = await unzip(buffer, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (!files['xl/workbook.xml']) throw new Error('This file is not a valid Excel workbook.');
  const shared = files['xl/sharedStrings.xml'] ? tags(parseXml(files['xl/sharedStrings.xml']), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
  const rels = files['xl/_rels/workbook.xml.rels'] ? Object.fromEntries(tags(parseXml(files['xl/_rels/workbook.xml.rels']), 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')])) : {};
  const sheets = tags(parseXml(files['xl/workbook.xml']), 'sheet').map(s => {
    const id = s.getAttribute('r:id') || [...s.attributes].find(a => a.localName === 'id')?.value;
    const target = String(rels[id] || '').replace(/^\/?(xl\/)?/, '');
    return { name: s.getAttribute('name'), path: 'xl/' + target };
  });
  // Use the first sheet in workbook order that actually has data.
  for (const sheet of sheets) {
    const xml = files[sheet.path];
    if (!xml) continue;
    const rows = tags(parseXml(xml), 'row').map(row => {
      const out = [];
      tags(row, 'c').forEach((c, i) => {
        const type = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
        const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? tags(c, 't').map(t => t.textContent).join('') : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
        out[c.getAttribute('r') ? colIndex(c.getAttribute('r')) : i] = value;
      });
      return Array.from(out, v => v ?? '');
    }).filter(r => r.some(v => String(v).trim()));
    if (rows.length) return { sheet: sheet.name, rows };
  }
  throw new Error('The workbook has no rows to import.');
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}

export async function readSpreadsheet(file, parseXml = s => new DOMParser().parseFromString(s, 'application/xml')) {
  const name = file.name || '';
  if (/\.csv$/i.test(name)) return { sheet: name, rows: parseCsv(await file.text()) };
  if (/\.xlsx$/i.test(name)) return readXlsx(await file.arrayBuffer(), parseXml);
  throw new Error('Choose an Excel (.xlsx) or CSV file. Older .xls files must be re-saved as .xlsx first.');
}

// Header detection is by meaning, so "Staff Name", "Mobile Phone Number", etc. all work.
export function mapColumns(header) {
  const keys = header.map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
  const find = test => keys.findIndex(test);
  return {
    name: find(k => k.includes('name') && !k.includes('company') && !k.includes('user')),
    email: find(k => k.includes('email')),
    phone: find(k => k.includes('phone') || k.includes('mobile') || k.includes('cell')),
    type: find(k => k === 'type' || k.endsWith('type') || k === 'accounttype'),
    title: find(k => k === 'role' || k.includes('title') || k.includes('position'))
  };
}

export function splitName(raw) {
  const name = String(raw).replace(/\s+/g, ' ').trim();
  if (name.includes(' ')) return { name, split: false };
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return { name: spaced, split: spaced !== name };
}

export function cleanPhone(raw) {
  const original = String(raw).trim();
  let d = original.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length === 10) return { phone: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, ok: true };
  return { phone: original, ok: !original };
}

const key = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Builds one preview row per spreadsheet row, matched to existing people by email, then by name.
export function planImport(rows, people) {
  if (rows.length < 2) throw new Error('The spreadsheet needs a header row and at least one person.');
  const cols = mapColumns(rows[0]);
  if (cols.name < 0) throw new Error('No name column found. Add a column titled "Name" or "Staff Name".');
  const active = people.filter(p => p && !p.gone), seen = new Set();
  return rows.slice(1).map((r, i) => {
    const get = c => c < 0 ? '' : String(r[c] ?? '').trim();
    const notes = [], errors = [];
    const { name, split } = splitName(get(cols.name));
    if (!name) errors.push('Missing name');
    if (split) notes.push('Name split from "' + get(cols.name) + '"');
    const email = get(cols.email).toLowerCase();
    if (email && !EMAIL.test(email)) errors.push('Invalid email');
    if (email && seen.has(email)) errors.push('Email repeated in file');
    if (email) seen.add(email);
    const { phone, ok } = cleanPhone(get(cols.phone));
    if (!ok) notes.push('Check phone number');
    const rawType = get(cols.type).toLowerCase();
    let acct = ['admin', 'staff', 'contractor'].includes(rawType) ? rawType : 'staff';
    if (rawType && acct !== rawType) notes.push('Unknown type "' + get(cols.type) + '", using Staff');
    const match = (email && active.find(p => (p.email || '').toLowerCase() === email))
      || active.filter(p => key(p.name) === key(name)).length === 1 && active.find(p => key(p.name) === key(name)) || null;
    const person = {
      n: name, email: email || (match?.email || ''), r: cols.title >= 0 && get(cols.title) ? get(cols.title) : (match?.role || ''),
      acct, phone: cols.phone >= 0 && phone ? phone : (match?.phone || ''), map: match ? !!match.map : true
    };
    const changes = match ? [['name', match.name, person.n], ['email', match.email || '', person.email], ['type', match.acct, person.acct], ['phone', match.phone || '', person.phone], ['title', match.role || '', person.r]]
      .filter(([, a, b]) => String(a) !== String(b)).map(([f]) => f) : [];
    if (acct === 'admin' && match?.acct !== 'admin') notes.push('Gets full administrator access');
    const status = errors.length ? 'error' : !match ? 'new' : changes.length ? 'update' : 'same';
    return { line: i + 2, person, id: match ? match.id : null, status, changes, notes, errors, include: status === 'new' || status === 'update' };
  });
}
