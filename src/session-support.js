// Session Support (Planning › Session Support): the general sessions and breakouts, each with two boxes, Notetakers
// and Moderators / Q&A Mics. A box holds named groups ("Notetaker", "Notes & pull quotes", "Q&A mics") of people
// from People, plus its own notes. Admins import the session support workbook (one tab per day), edit cards, and
// export PDF / Excel; staff and contractors see only the cards they are on, with everyone on them.
import { readAllSheets } from './people-import.js';
import { matchPerson, listName } from './rooming-import.js';
import { headingDates, withHeading } from './schedule-import.js';
import { parseTime } from './flight-import.js';
import { xlsx } from './xlsx-writer.js';

export const BOXES = [['nt', 'Notetakers', 'Notetaker'], ['md', 'Moderators / Q&A Mics', 'Moderators / Q&A mics']];
const text = v => String(v ?? '').replace(/ /g, ' ').trim();
const lines = v => text(v).split(/\s*\n\s*/).map(x => x.trim()).filter(Boolean);
const key = h => String(h ?? '').toLowerCase().replace(/[^a-z]/g, '');
const mins = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const SMALL = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
// "GENERAL SESSION" -> "General Session"; mixed-case text is left alone.
const tidy = s => /[a-z]/.test(s) ? s : s.toLowerCase().replace(/[a-z][a-z']*/g, (w, i) => i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)).replace(/\bq&a\b/gi, 'Q&A');

// "9:00 AM - 10:30 AM" -> [540, 630]; one time -> [t, t].
export function timeRange(v) {
  const s = text(v).replace(/[–—]/g, '-');
  if (!s) return null;
  const parts = s.split(/\s+-\s+|\s*-\s*(?=\d)/);
  const a = parseTime(parts[0]), b = parts[1] ? parseTime(parts[1]) : a;
  if (!a || !b) return null;
  let x = mins(a), y = mins(b);
  if (!/[ap]\.?m/i.test(parts[0]) && /p\.?m/i.test(parts[1] || '') && x < 720 && x + 720 <= y) x += 720; // "1:40 - 2:30 PM"
  if (y === 0 && x > 0) y = 1440;
  return [x, y];
}

// Group names as the app shows them.
export function roleLabel(raw) {
  const k = text(raw).toLowerCase().replace(/\s+/g, ' ');
  if (/^note ?takers?$/.test(k)) return 'Notetaker';
  if (/^notes? (&|and) pull quotes?$/.test(k)) return 'Notes & pull quotes';
  if (/help with (the )?doors|^doors?$/.test(k)) return 'Help with doors';
  const s = k.replace(/\s*\/\s*|\s+and\s+/g, ' / ').replace(/q&a/g, 'Q&A');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The Team Leads cell: "Q&A Mics: \nA/B\n\nNotetakers: \nC\nNotes & Pull Quotes: D/E" -> groups with raw names.
export function parseSupport(raw) {
  const groups = [];
  let cur = null;
  const group = (label, box) => groups.find(g => g.label === label && g.box === box) || (groups.push({ label, box, names: [] }), groups[groups.length - 1]);
  for (const ln of lines(raw)) {
    const m = ln.match(/^([A-Za-z][A-Za-z &/-]{1,40}?)\s*:\s*(.*)$/);
    let rest = ln;
    if (m) { cur = group(roleLabel(m[1]), /note/i.test(m[1]) ? 'nt' : 'md'); rest = m[2]; }
    if (!rest) continue;
    if (!cur) cur = group('Team', 'md');
    for (const n of rest.split(/\s*(?:\/|,|;|&|\band\b)\s*/i).map(x => x.trim()).filter(Boolean)) if (!cur.names.includes(n)) cur.names.push(n);
  }
  return groups.filter(g => g.names.length);
}

function columns(header) {
  const k = header.map(key), at = test => k.findIndex(test);
  const c = { track: at(x => x === 'track'), time: at(x => x === 'time' || x === 'times'), room: at(x => x === 'location' || x === 'room' || x === 'venue'),
    title: at(x => x.startsWith('presentation') || x === 'topic' || x === 'session' || x === 'title'), speakers: at(x => x.startsWith('speaker') || x === 'presenter' || x === 'presenters' || x === 'hosts'),
    leads: at(x => x.startsWith('teamlead') || x.startsWith('support') || x === 'staff' || x === 'team') };
  // A merged Presentation cell spreads into the blank-headed columns after it.
  c.titleSpan = [];
  if (c.title >= 0) for (let i = c.title; i < header.length && (i === c.title || !k[i]); i++) c.titleSpan.push(i);
  return c;
}
const isHeader = cells => { const k = cells.map(key); return k.some(x => x === 'time' || x === 'times') && k.some(x => x === 'location' || x === 'room'); };

// sheets: [{sheet, rows}] -> {items, unmatched, headings, year}. Each tab's day heading ("TUESDAY, NOVEMBER 10") dates
// its rows; single-cell rows under it ("GENERAL SESSION", "BREAKOUTS 11:00 AM - 12:30 PM") name the block.
export function planSupport(sheets, people, eventStart) {
  const year = Number(eventStart.slice(0, 4)), start = Date.parse(eventStart + 'T00:00:00Z');
  const items = [], headings = [];
  for (const { sheet, rows } of sheets) {
    let cols = null, date = '', hk = null, blk = '';
    rows.forEach((cells, i) => {
      const filled = cells.map(text).filter(Boolean);
      if (!filled.length) return;
      if (isHeader(cells)) { cols = columns(cells); return; }
      if (filled.length === 1) {
        const h = headingDates(cells, year);
        if (h.date) { hk = h.alt ? 'h' + headings.length : null; if (hk) headings.push({ key: hk, text: h.text, date: h.date, alt: h.alt }); date = h.alt || h.date; blk = ''; cols = null; return; }
        if (date) { blk = lines(filled[0]).map(l => { const t = timeRange(l); return t ? span({ a: t[0], b: t[1] }) : tidy(l); }).join(' · '); cols = null; }
        return;
      }
      if (!cols || !date) return;
      const room = lines(cells[cols.room]).join(' ');
      const titleCell = cols.titleSpan.map(j => text(cells[j])).find(v => v && v.toLowerCase() !== room.toLowerCase()) || '';
      const tl = lines(titleCell).map(tidy);
      const trk = lines(cols.track >= 0 ? cells[cols.track] : '').map(tidy).join(' ');
      const title = tl.length ? tl[0] + (tl.length > 1 ? (/[:!?]$/.test(tl[0]) ? ' ' : ': ') + tl.slice(1).join(' ') : '') : trk;
      if (!title) return;
      const t = timeRange(cells[cols.time]) || (cols.track >= 0 ? timeRange(cells[cols.track]) : null);
      const brk = /^(break|lunch|breakfast|dinner)\b/i.test(title) || /^(break|lunch)\b/i.test(trk);
      const leads = cols.leads >= 0 ? cells[cols.leads] : '';
      const day = Math.round((Date.parse(date + 'T00:00:00Z') - start) / 86400000);
      const groups = brk ? [] : parseSupport(leads).map(g => ({ ...g, names: g.names.map(raw => { const m = matchPerson(listName(raw), people); return { raw, e: m.person ? m.person.id : null, how: m.how, others: m.others }; }) }));
      items.push({ line: sheet + ' row ' + (i + 1), hk, date, day, blk, trk: brk ? '' : trk.replace(/^(break|lunch)$/i, ''), t: title.slice(0, 200), r: room.slice(0, 120),
        sp: lines(cols.speakers >= 0 ? cells[cols.speakers] : '').join('\n').slice(0, 1000), brk, note: brk ? lines(leads).join(' · ').slice(0, 500) : '',
        a: t ? t[0] : null, b: t ? t[1] : null, groups, skip: false });
    });
  }
  const unmatched = {};
  for (const it of items) for (const g of it.groups) for (const n of g.names) if (n.how !== 'exact') {
    const k = n.raw.toLowerCase();
    if (!unmatched[k]) unmatched[k] = { raw: n.raw, e: n.e, how: n.how, others: n.others, rows: 0 };
    unmatched[k].rows++;
  }
  return { items, unmatched, headings, year };
}

// The rows to send, with the admin's name choices; boxes with no group get the default one so people can be added.
export function supportRow(it, choice) {
  const pick = n => n.how === 'exact' ? n.e : choice[n.raw.toLowerCase()] ?? null;
  const roles = it.groups.map(g => ({ box: g.box, label: g.label }));
  if (!it.brk) for (const [box, , dflt] of BOXES) if (!roles.some(r => r.box === box)) roles.push({ box, label: dflt });
  const ppl = [];
  for (const g of it.groups) for (const n of g.names) { const e = pick(n); if (e != null && !ppl.some(p => p.box === g.box && p.role === g.label && p.e === e)) ppl.push({ box: g.box, role: g.label, e }); }
  return { d: it.day, a: it.a, b: it.b, blk: it.blk, trk: it.trk, t: it.t, r: it.r, sp: it.sp, brk: it.brk, note: it.note, roles, ppl };
}

// Which existing card each row updates (same day, start time and title; each card once), and what changes.
export function supportEffects(items, existing, days) {
  const used = new Set();
  return items.map(it => {
    if (it.skip) return { kind: 'skip', text: 'Skipped' };
    if (it.a == null) return { kind: 'error', text: 'No time' };
    if (it.day < 0 || it.day >= days) return { kind: 'error', text: 'Outside the event\'s days' };
    const old = existing.find(x => !used.has(x.id) && x.d === it.day && x.a === it.a && x.t.trim().toLowerCase() === it.t.toLowerCase());
    if (!old) return { kind: 'new', text: it.brk ? 'New break' : 'New card' };
    used.add(old.id);
    return { kind: 'update', old, text: 'Updates the card' };
  });
}

const fmt = m => { const h = Math.floor(m / 60) % 24, x = m % 60; return (h % 12 || 12) + ':' + String(x).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
export const span = s => s.b === s.a ? fmt(s.a) : fmt(s.a) + '–' + fmt(s.b);
const dayText = (ev, d, long) => { const t = new Date(ev.start + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toLocaleDateString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' }); };
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A card's groups for one box, in order, with their people: [{label, people: [{e, n}]}].
export function groupsOf(s, box) {
  const labels = [...(s.roles || []).filter(r => r.box === box).map(r => r.label)];
  for (const p of s.ppl || []) if (p.box === box && !labels.includes(p.role)) labels.push(p.role);
  return labels.map(label => ({ label, people: (s.ppl || []).filter(p => p.box === box && p.role === label) }));
}
const groupText = (s, box) => groupsOf(s, box).filter(g => g.people.length).map(g => g.label + ': ' + g.people.map(p => p.n).join(', ')).join('\n');

export function supportDoc(list, ev, autoPrint = false) {
  const byDay = [...new Set(list.map(s => s.d))].sort((a, b) => a - b);
  const body = byDay.map(d => `<h2>${esc(dayText(ev, d, true))}</h2><table><thead><tr><th class="t">Time</th><th>Session</th><th>Notetakers</th><th>Moderators / Q&amp;A Mics</th></tr></thead><tbody>${
    list.filter(s => s.d === d).map(s => s.brk ? `<tr class="brk"><td class="t">${esc(span(s))}</td><td colspan="3"><b>${esc(s.t)}</b>${s.r ? ' · ' + esc(s.r) : ''}${s.note ? ' · ' + esc(s.note) : ''}</td></tr>`
      : `<tr><td class="t">${esc(span(s))}</td><td>${s.blk || s.trk ? `<span class="m">${esc([s.blk, s.trk].filter(Boolean).join(' · '))}</span><br>` : ''}<b>${esc(s.t)}</b><br>${esc(s.r)}${s.sp ? `<br><span class="m">${esc(s.sp).replace(/\n/g, '<br>')}</span>` : ''}</td>${
        ['nt', 'md'].map(box => `<td>${groupsOf(s, box).filter(g => g.people.length).map(g => `<b>${esc(g.label)}:</b> ${esc(g.people.map(p => p.n).join(', '))}`).join('<br>') || '<span class="m">None</span>'}${(box === 'nt' ? s.ntn : s.mdn) ? `<p class="n">${esc(box === 'nt' ? s.ntn : s.mdn)}</p>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ev.name)} Session Support</title><style>@page{size:letter landscape;margin:.4in}body{font:11px/1.4 system-ui,sans-serif;color:#000;margin:16px}h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 4px;border-bottom:2px solid #0f766e;padding-bottom:3px;break-after:avoid}.m{color:#555}p.m{margin:0 0 10px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border-top:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:#e8eeed;border-top:0}.t{width:12%;white-space:nowrap}tr.brk td{background:#f3f6f5}p.n{margin:4px 0 0;padding:3px 5px;background:#fff7e0;white-space:pre-line}tr{break-inside:avoid}thead{display:table-header-group}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print or save as PDF</button><h1>${esc(ev.name)}: Session Support</h1><p class="m">${list.filter(s => !s.brk).length} sessions · Printed ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</p>${body || '<p class="m">No sessions yet.</p>'}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>' : ''}</body></html>`;
}

export function supportSheet(list, ev) {
  return [['Day', 'Start', 'End', 'Block', 'Track', 'Session', 'Location', 'Speakers', 'Notetakers', 'Notetaker notes', 'Moderators / Q&A Mics', 'Moderator notes'],
    ...list.map(s => [dayText(ev, s.d), fmt(s.a), s.b === s.a ? '' : fmt(s.b), s.blk, s.trk, s.t, s.r, s.sp, s.brk ? s.note : groupText(s, 'nt'), s.ntn || '', s.brk ? '' : groupText(s, 'md'), s.mdn || ''])];
}

export function createSessionSupport({ React, html, Modal, Icon, people, events, current }) {
  const { useState } = React;
  const evOf = id => events.find(e => e.id === id) || {};
  const cardsOf = S => (S.support || []).filter(s => s.ev === current.id).sort((x, y) => x.d - y.d || x.a - y.a || x.id - y.id);
  const pool = () => people.filter(p => p && !p.gone).sort((a, b) => a.name.localeCompare(b.name));
  // Consecutive cards with the same block share a heading; a break or lunch stays in the block it falls in.
  const blocksOf = list => { const out = []; for (const s of list) { const k = s.blk || ''; let b = out[out.length - 1]; if (!b || (b.k !== k && !s.brk)) { b = { k, list: [] }; out.push(b); } b.list.push(s); } return out; };

  function Box({ s, box, label, A, admin, me, usual }) {
    const [notes, setNotes] = useState(null);
    const saved = (box === 'nt' ? s.ntn : s.mdn) || '';
    const groups = groupsOf(s, box);
    const setGroup = (g, ids) => A.setSupportPeople(s.id, box, g.label, ids);
    return html`<fieldset className="support-box"><legend>${label}</legend>
      ${groups.map(g => { const ids = g.people.map(p => p.e), free = pool().filter(p => !ids.includes(p.id));
        return html`<div className="support-group" key=${g.label}><span className="support-group-label">${g.label}</span><div className="support-chips">
          ${g.people.map(p => html`<span key=${p.e} className=${'support-chip' + (p.e === me ? ' me' : '')}>${p.e === me ? 'You' : p.n}${admin && html`<button type="button" aria-label=${'Remove ' + p.n + ' from ' + g.label} onClick=${() => setGroup(g, ids.filter(x => x !== p.e))}><${Icon} name="close" size=${14}/></button>`}</span>`)}
          ${!g.people.length && html`<span className="mute">No one yet</span>`}
          ${admin && html`<select className="support-add" aria-label=${'Add a person to ' + g.label + ', ' + s.t} value="" onChange=${e => e.target.value && setGroup(g, [...ids, Number(e.target.value)])}>
            <option value="">+ Add person</option>
            <optgroup label="On Session Support">${free.filter(p => usual.has(p.id)).map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</optgroup>
            <optgroup label="Everyone else">${free.filter(p => !usual.has(p.id)).map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</optgroup></select>`}
        </div></div>`; })}
      ${admin ? html`<label className="support-notes">${box === 'nt' ? 'Notetaker notes' : 'Moderator notes'}<textarea rows="2" maxLength="2000" value=${notes ?? saved} onChange=${e => setNotes(e.target.value)}
          onBlur=${async () => { if (notes != null && notes.trim() !== saved) { await A.setSupportNotes(s.id, box, notes.trim()); } setNotes(null); }}></textarea></label>`
        : saved && html`<p className="support-note-text"><b>${box === 'nt' ? 'Notetaker notes' : 'Moderator notes'}:</b> ${saved}</p>`}
    </fieldset>`;
  }

  function Card({ s, A, admin, me, usual, onEdit }) {
    const [confirm, setConfirm] = useState(false);
    if (s.brk) return html`<div className="support-break"><b>${s.t}</b><span>${span(s)}</span>${s.r && html`<span>${s.r}</span>`}${s.note && html`<span>${s.note}</span>`}
      ${admin && html`<span className="support-break-actions"><button type="button" className="btn ghost" onClick=${() => onEdit(s)}><${Icon} name="edit"/>Edit</button></span>`}</div>`;
    return html`<article className="support-card">
      <div className="support-card-top"><span className="pill">${admin ? span(s) : evDay(s) + ' · ' + span(s)}</span><span className="mute">${s.r}</span></div>
      <div>${s.trk && html`<span className="support-track">${s.trk}</span>`}<h4>${s.t}</h4>${s.sp && html`<p className="mute support-speakers">${s.sp}</p>`}</div>
      ${BOXES.map(([box, label]) => html`<${Box} key=${box} s=${s} box=${box} label=${label} A=${A} admin=${admin} me=${me} usual=${usual}/>`)}
      ${admin && html`<div className="acts">${confirm ? html`<span className="mute">Delete this card? People on it are told.</span><button type="button" className="btn danger" onClick=${() => A.delSupport(s.id)}>Confirm delete</button><button type="button" className="btn ghost" onClick=${() => setConfirm(false)}>Cancel</button>`
        : html`<button type="button" className="btn ghost" onClick=${() => onEdit(s)}><${Icon} name="edit"/>Edit</button><button type="button" className="btn ghost" onClick=${() => setConfirm(true)}><${Icon} name="delete"/>Delete</button>`}</div>`}
    </article>`;
  }
  const evDay = s => dayText(evOf(s.ev), s.d);

  function Editor({ card, A, onClose }) {
    const ev = evOf(current.id), isNew = !card.id;
    const t2 = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const labels = box => (card.roles || []).filter(r => r.box === box).map(r => r.label).join(', ');
    const [d, setD] = useState({ t: card.t || '', trk: card.trk || '', blk: card.blk || '', day: card.d ?? 0, a: t2(card.a ?? 540), b: t2(card.b ?? 600), r: card.r || '', sp: card.sp || '', brk: !!card.brk, note: card.note || '',
      nt: isNew ? 'Notetaker' : labels('nt'), md: isNew ? 'Moderators / Q&A mics' : labels('md') });
    const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
    const set = k => e => setD(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    const m = v => { const [h, x] = v.split(':').map(Number); return h * 60 + x; };
    const save = async e => { e.preventDefault(); setErr('');
      if (!d.t.trim()) { setErr('Enter a title.'); return; }
      const a = m(d.a), b = m(d.b);
      if (b < a) { setErr('The end time is before the start time.'); return; }
      const roles = d.brk ? [] : ['nt', 'md'].flatMap(box => d[box].split(',').map(x => x.trim()).filter(Boolean).map(label => ({ box, label: label.slice(0, 60) })));
      setBusy(true);
      const r = await A.saveSupport(card.id ?? null, current.id, { d: Number(d.day), a, b, blk: d.blk.trim(), trk: d.trk.trim(), t: d.t.trim(), r: d.r.trim(), sp: d.sp.trim(), brk: d.brk, note: d.note.trim(), roles });
      setBusy(false); if (r !== false) onClose(); else setErr('Could not save. Check the values and try again.'); };
    return html`<${Modal} title=${isNew ? 'Add session' : 'Edit ' + (card.brk ? 'break' : 'session')} onClose=${busy ? () => {} : onClose}><form onSubmit=${save}><div className="editor-fields">
      <label className="wide-field">Title<input required maxLength="200" value=${d.t} onChange=${set('t')}/></label>
      <label>Day<select value=${d.day} onChange=${set('day')}>${Array.from({ length: ev.days || 1 }, (_, i) => html`<option key=${i} value=${i}>${dayText(ev, i)}</option>`)}</select></label>
      <label>Location<input maxLength="120" value=${d.r} onChange=${set('r')}/></label>
      <label>Start time<input type="time" required value=${d.a} onChange=${set('a')}/></label>
      <label>End time<input type="time" required value=${d.b} onChange=${set('b')}/></label>
      <label>Block<input maxLength="120" value=${d.blk} placeholder="For example, General Session or Breakouts" onChange=${set('blk')}/></label>
      <label>Track<input maxLength="120" value=${d.trk} placeholder="For example, Breakout 2" onChange=${set('trk')}/></label>
      <label className="chk wide-field"><input type="checkbox" checked=${d.brk} onChange=${set('brk')}/>Break or lunch (no support boxes)</label>
      ${d.brk ? html`<label className="wide-field">Note<input maxLength="500" value=${d.note} placeholder="For example, Last call 12:20 & 12:30 PM: Bre Binder / Erin Washburn" onChange=${set('note')}/></label>`
        : html`<label className="wide-field">Speakers<textarea rows="3" maxLength="1000" value=${d.sp} onChange=${set('sp')}></textarea></label>
        <label className="wide-field">Notetaker groups<input value=${d.nt} onChange=${set('nt')}/><span className="mute field-hint">Separate with commas, for example: Notetaker, Notes & pull quotes. Removing a group takes its people off.</span></label>
        <label className="wide-field">Moderator groups<input value=${d.md} onChange=${set('md')}/><span className="mute field-hint">For example: Q&A mics, Help with doors.</span></label>`}
      </div>${err && html`<p className="connection-error editor-error" role="alert">${err}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="submit" className="btn" disabled=${busy}>${isNew ? 'Add session' : 'Save changes'}</button></div></form><//>`;
  }

  function Importer({ S, A, onClose }) {
    const ev = evOf(current.id);
    const [plan, setPlan] = useState(null), [file, setFile] = useState(''), [choice, setChoice] = useState({}), [use, setUse] = useState({});
    const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState('');
    const pick = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; setErr(''); setDone('');
      try { const p = planSupport(await readAllSheets(f), people, ev.start);
        if (!p.items.length) throw new Error('No sessions found. Each tab needs a day heading like "TUESDAY, NOVEMBER 10" and a Time / Location / Presentation header row.');
        setPlan(p); setFile(f.name); setUse({}); setChoice(Object.fromEntries(Object.entries(p.unmatched).map(([k, u]) => [k, u.e ?? null]))); }
      catch (x) { setPlan(null); setErr(x.message || 'Could not read the file.'); } };
    const items = plan ? plan.items.map(it => withHeading(it, plan.headings, use, ev.start)) : [];
    const fx = supportEffects(items, cardsOf(S), ev.days || 1);
    const ok = items.filter((x, i) => ['new', 'update'].includes(fx[i].kind));
    const tally = k => fx.filter(f => f.kind === k).length, bad = fx.some(f => f.kind === 'error');
    const setItem = (i, patch) => setPlan(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, ...patch } : x) }));
    const nameFor = n => { const e = n.how === 'exact' ? n.e : choice[n.raw.toLowerCase()]; return e != null && people[e] ? people[e].name : null; };
    const save = async () => { setBusy(true); setErr('');
      const r = await A.importSupport(current.id, ok.map(x => supportRow(x, choice))); setBusy(false);
      if (r !== false) setDone(tally('new') + ' added, ' + tally('update') + ' updated. People get a notice in the app; no pushes were sent.');
      else setErr('Could not import. Check the rows and try again.'); };
    const unmatched = plan ? Object.entries(plan.unmatched) : [];
    return html`<${Modal} title="Import Session Support" onClose=${busy ? () => {} : onClose}><div className="rooming-import schedule-import">
      <p className="mute">For ${ev.name}. Choose the session support workbook. Every tab is read: its day heading sets the date, and the Team Leads column fills the Notetakers and Moderators / Q&A Mics groups. Re-importing updates cards with the same day, start time, and title; notes are kept.</p>
      <label className="btn ghost file-pick"><${Icon} name="upload"/>${plan ? 'Choose a different file' : 'Choose file'}<input type="file" accept=".xlsx,.csv" onChange=${pick}/></label>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      ${plan && !done && html`
        <p className="import-summary"><b>${file}</b>: ${items.length} rows · ${tally('new')} new · ${tally('update')} updates${tally('skip') ? ' · ' + tally('skip') + ' skipped' : ''}${bad ? ' · ' + tally('error') + ' to fix' : ''}</p>
        ${plan.headings.length > 0 && html`<fieldset className="name-fixes"><legend>Dates to check</legend>${plan.headings.map(h => html`<label key=${h.key} className="name-fix"><span><b>${h.text}</b><span className="cell-secondary warn-text">The weekday and date don't match</span></span>
          <select aria-label=${'Day for ' + h.text} value=${use[h.key] || 'weekday'} onChange=${e => setUse(u => ({ ...u, [h.key]: e.target.value }))}><option value="weekday">The weekday (${h.alt})</option><option value="date">The date (${h.date})</option></select></label>`)}</fieldset>`}
        ${unmatched.length > 0 && html`<fieldset className="name-fixes"><legend>Names to check <span className="mute">${unmatched.length}</span></legend>
          ${unmatched.map(([k, u]) => html`<label key=${k} className="name-fix"><span><b>${u.raw}</b><span className=${'cell-secondary ' + (u.e != null ? 'warn-text' : '')}>${u.how === 'close' ? 'Close match' : u.others.length ? 'Not sure' : 'Not found in People'} · ${u.rows} row${u.rows === 1 ? '' : 's'}</span></span>
            <select aria-label=${'Person for ' + u.raw} value=${choice[k] ?? ''} onChange=${e => setChoice(c => ({ ...c, [k]: e.target.value === '' ? null : Number(e.target.value) }))}>
              <option value="">Leave out</option>${u.others.length > 0 && html`<optgroup label="Suggested">${u.others.map(p => html`<option key=${'o' + p.id} value=${p.id}>${p.name}</option>`)}</optgroup>`}
              <optgroup label="Everyone">${pool().map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</optgroup></select></label>`)}</fieldset>`}
        <div className="data-surface rooming-table"><table className="data-table"><thead><tr><th scope="col">When</th><th scope="col">Session</th><th scope="col">Notetakers</th><th scope="col">Moderators / Q&A Mics</th><th scope="col">Result</th></tr></thead><tbody>
          ${items.map((x, i) => { const f = fx[i], gs = box => x.groups.filter(g => g.box === box).map(g => g.label + ': ' + (g.names.map(nameFor).filter(Boolean).join(', ') || '–')).join('; ');
            return html`<tr key=${x.line} className=${'imp-' + f.kind}>
            <td><b>${x.date ? dayText({ start: x.date }, 0) : 'No day'}</b><span className="cell-secondary">${x.a == null ? 'No time' : span(x)}</span></td>
            <td><b>${x.t}</b><span className="cell-secondary">${[x.blk, x.trk, x.r].filter(Boolean).join(' · ')}</span>${x.brk && x.note && html`<span className="cell-secondary">${x.note}</span>`}</td>
            <td>${x.brk ? html`<span className="mute">Break</span>` : gs('nt') || html`<span className="mute">–</span>`}</td><td>${x.brk ? '' : gs('md') || html`<span className="mute">–</span>`}</td>
            <td>${f.text}<label className="chk"><input type="checkbox" checked=${x.skip} onChange=${e => setItem(i, { skip: e.target.checked })}/>Skip</label></td></tr>`; })}
        </tbody></table></div>`}
      ${done && html`<p className="mute" role="status">${done}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>${done ? 'Close' : 'Cancel'}</button>
        ${plan && !done && html`<button type="button" className="btn" disabled=${busy || bad || !ok.length} onClick=${save}>${busy ? 'Importing…' : 'Import ' + ok.length + ' row' + (ok.length === 1 ? '' : 's')}</button>`}</div>
      ${bad && html`<p className="connection-error" role="alert">Fix or skip the rows marked in red before importing.</p>`}
    </div><//>`;
  }

  // Admin page: day tabs, blocks of cards, import, add, PDF and Excel.
  function SupportAdmin({ S, A }) {
    const ev = evOf(current.id), all = cardsOf(S);
    const days = [...new Set(all.map(s => s.d))].sort((a, b) => a - b);
    const [day, setDay] = useState(null), [editing, setEditing] = useState(null), [importing, setImporting] = useState(false), [msg, setMsg] = useState('');
    const cur = days.includes(day) ? day : days[0];
    const usual = new Set((S.support || []).flatMap(s => (s.ppl || []).map(p => p.e)));
    const list = all.filter(s => s.d === cur);
    const pdf = () => { const url = URL.createObjectURL(new Blob([supportDoc(all, ev, true)], { type: 'text/html' })), w = window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMsg(w ? '' : 'Your browser blocked the report window. Allow pop-ups for this site and try again.'); };
    const excel = () => { const data = xlsx('Session Support', supportSheet(all, ev), [16, 9, 9, 22, 22, 40, 24, 36, 40, 30, 40, 30]);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = String(ev.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-session-support.xlsx'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); setMsg('Excel file saved.'); };
    return html`<div className="support-page">
      <div className="support-toolbar">
        ${days.length > 0 && html`<div className="seg day-tabs" role="group" aria-label="Day">${days.map(d => html`<button key=${d} type="button" aria-pressed=${d === cur} onClick=${() => setDay(d)}>${dayText(ev, d)}</button>`)}</div>`}
        <div className="heading-actions"><button type="button" className="btn ghost" disabled=${!all.length} onClick=${pdf}><${Icon} name="print"/>PDF</button><button type="button" className="btn ghost" disabled=${!all.length} onClick=${excel}><${Icon} name="download"/>Excel</button>
          <button type="button" className="btn ghost" onClick=${() => setImporting(true)}><${Icon} name="upload"/>Import workbook</button><button type="button" className="btn" onClick=${() => setEditing({ d: cur ?? 0 })}><${Icon} name="plus"/>Add session</button></div>
      </div>
      ${msg && html`<p className="mute export-msg" role="status">${msg}</p>`}
      ${!all.length ? html`<div className="empty-state"><${Icon} name="mic" size=${28}/><h3>No Session Support cards yet</h3><p className="mute">Import the session support workbook, or add sessions one at a time.</p><button className="btn" onClick=${() => setImporting(true)}><${Icon} name="upload"/>Import workbook</button></div>`
        : html`<h3 className="support-day">${dayText(ev, cur, true)}</h3>${blocksOf(list).map((b, i) => html`<section key=${i} className="support-block">${b.k && html`<h4 className="support-block-title">${b.k}</h4>`}
          <div className="support-grid">${b.list.map(s => html`<${Card} key=${s.id} s=${s} A=${A} admin=${true} me=${null} usual=${usual} onEdit=${setEditing}/>`)}</div></section>`)}`}
      ${editing && html`<${Editor} card=${editing} A=${A} onClose=${() => setEditing(null)}/>`}
      ${importing && html`<${Importer} S=${S} A=${A} onClose=${() => setImporting(false)}/>`}
    </div>`;
  }

  // Staff and contractors: the cards they are on, with everything on them.
  function MySupport({ S, me }) {
    const mine = cardsOf(S).filter(s => !s.brk && (s.ppl || []).some(p => p.e === me));
    if (!mine.length) return null;
    return html`<section className="my-support"><h2>Session Support</h2><p className="mute">The sessions you're supporting, and who you're working with.</p>
      ${mine.map(s => html`<${Card} key=${s.id} s=${s} A=${null} admin=${false} me=${me} usual=${new Set()} onEdit=${() => {}}/>`)}</section>`;
  }

  return { SupportAdmin, MySupport };
}
