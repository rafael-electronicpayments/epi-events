// Attendees (its own menu group): the event's attendee list, imported from the registration report (First Name,
// Last Name, Company Name, Invitee Status, Primary Registrant (Guest of), Registration Type). Admins import, search,
// filter, and export PDF / Excel, and choose which staff can view the list for each event; those staff get an
// Attendee list card that opens the same list with every column. Re-importing only adds and updates: a row whose
// first and last name match someone already on the list (ignoring capitals and extra spaces) updates that person;
// when two people share a name, the company decides which. Nobody is ever removed by an import.
import { readAllSheets } from './people-import.js';
import { xlsx } from './xlsx-writer.js';

const text = v => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const low = v => text(v).toLowerCase();
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const FIELDS = [['f', 'First Name', 100], ['l', 'Last Name', 100], ['c', 'Company Name', 200], ['st', 'Invitee Status', 60], ['g', 'Primary Registrant (Guest of)', 200], ['rt', 'Registration Type', 60]];
export const HEAD = FIELDS.map(x => x[1]);

// Column positions by meaning, so small header changes ("Company", "Reg Type", "Guest Of") still work.
export function attendeeColumns(header) {
  const k = header.map(h => low(h).replace(/[^a-z]/g, ''));
  const find = test => k.findIndex(test);
  return {
    f: find(x => x.includes('first')),
    l: find(x => x.includes('last')),
    c: find(x => x.includes('company') || x === 'organization' || x === 'organisation'),
    st: find(x => x.includes('status')),
    g: find(x => x.includes('primary') || x.includes('guestof')),
    rt: find(x => (x.includes('registration') || x.includes('reg')) && x.includes('type'))
  };
}

// Rows from the first sheet that has a First Name / Last Name header: {items: [{line, f, l, c, st, g, rt, err}]}.
export function planAttendees(sheets) {
  for (const { rows } of sheets) {
    const hi = rows.findIndex(r => { const m = attendeeColumns(r); return m.f >= 0 && m.l >= 0; });
    if (hi < 0) continue;
    const m = attendeeColumns(rows[hi]), items = [];
    rows.slice(hi + 1).forEach((r, i) => {
      const o = Object.fromEntries(FIELDS.map(([key]) => [key, m[key] >= 0 ? text(r[m[key]]) : '']));
      if (!FIELDS.some(([key]) => o[key])) return;
      const long = FIELDS.find(([key, , max]) => o[key].length > max);
      o.err = !o.f || !o.l ? 'Needs a first and last name' : long ? long[1] + ' is longer than ' + long[2] + ' characters' : '';
      items.push({ line: hi + i + 2, ...o });
    });
    return { items, missing: FIELDS.filter(([key]) => m[key] < 0).map(x => x[1]) };
  }
  throw new Error('No attendee list found. The file needs a header row with First Name and Last Name.');
}

// What importing does to each row, matched the same way the server does: first an exact name AND company match,
// then a name-only match to someone not matched yet. Result per row: {kind: new|update|same|dup|error, id?, changes?}.
export function attendeeEffects(items, existing) {
  const key = (f, l) => low(f) + '|' + low(l), used = new Set(), out = items.map(() => null), seen = new Set();
  items.forEach((x, i) => { if (x.err) { out[i] = { kind: 'error', text: x.err }; return; }
    const k = key(x.f, x.l) + '|' + low(x.c);
    if (seen.has(k)) out[i] = { kind: 'dup', text: 'Repeated in the file; skipped' }; seen.add(k); });
  const pass = (test) => items.forEach((x, i) => { if (out[i] || x.skip) return;
    const hit = existing.filter(a => !used.has(a.id) && key(a.f, a.l) === key(x.f, x.l) && test(a, x)).sort((a, b) => a.id - b.id)[0];
    if (!hit) return; used.add(hit.id);
    const changes = FIELDS.filter(([k2]) => text(hit[k2]) !== x[k2]).map(f => f[1]);
    out[i] = changes.length ? { kind: 'update', id: hit.id, changes, text: 'Updates ' + changes.join(', ') } : { kind: 'same', id: hit.id, text: 'No change' }; });
  pass((a, x) => low(a.c) === low(x.c));
  pass(() => true);
  return items.map((x, i) => x.skip && !out[i] ? { kind: 'skip', text: 'Skipped' } : out[i] || { kind: 'new', text: 'New' });
}

// A guest's "Primary Registrant (Guest of)" names someone else; a primary registrant's names themself.
export const isGuest = a => !!text(a.g) && low(a.g) !== low(a.l + ', ' + a.f) && low(a.g) !== low(a.f + ' ' + a.l);
export const sortAttendees = list => [...list].sort((a, b) => low(a.l).localeCompare(low(b.l)) || low(a.f).localeCompare(low(b.f)) || a.id - b.id);
export const rowOf = a => FIELDS.map(([k]) => a[k] || '');
export function filterAttendees(list, { q = '', rt = '', st = '', kind = '' } = {}) {
  const words = low(q).split(' ').filter(Boolean);
  return list.filter(a => (!rt || a.rt === rt) && (!st || a.st === st) && (!kind || (kind === 'guest') === isGuest(a))
    && words.every(w => low([a.f, a.l, a.c, a.g, a.rt, a.st].join(' ')).includes(w)));
}

export function attendeeDoc(title, rows, sub, autoPrint = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{size:letter landscape;margin:.4in}body{font:11px/1.35 system-ui,sans-serif;color:#000;margin:16px}h1{font-size:18px;margin:0 0 2px}.m{color:#555;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:#e8eeed;border-top:0}tr{break-inside:avoid}thead{display:table-header-group}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print or save as PDF</button><h1>${esc(title)}</h1><p class="m">${esc(sub)} · Printed ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</p>${rows.length ? `<table><thead><tr>${HEAD.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="m">No attendees match.</p>'}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>' : ''}</body></html>`;
}

export function createAttendees({ React, html, Modal, Icon, people, events, current }) {
  const { useState } = React;
  const evOf = id => events.find(e => e.id === id) || {};
  const listOf = S => sortAttendees((S.attendees || []).filter(a => a.ev === current.id));
  const slug = ev => String(ev.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // Search, filters, the table, and PDF / Excel of what's shown. Used by admins and by staff who can view the list.
  function AttendeeList({ S, compact }) {
    const ev = evOf(current.id), all = listOf(S);
    const [f, setF] = useState({ q: '', rt: '', st: '', kind: '' }), [msg, setMsg] = useState('');
    const set = k => e => setF(o => ({ ...o, [k]: e.target.value }));
    const shown = filterAttendees(all, f), rows = shown.map(rowOf);
    const types = [...new Set(all.map(a => a.rt).filter(Boolean))].sort(), statuses = [...new Set(all.map(a => a.st).filter(Boolean))].sort();
    const guests = all.some(isGuest), filtered = f.q || f.rt || f.st || f.kind;
    const sub = (ev.name || '') + ' · ' + (filtered ? shown.length + ' of ' + plural(all.length, 'attendee') : plural(all.length, 'attendee'))
      + (f.rt ? ' · ' + f.rt : '') + (f.st ? ' · ' + f.st : '') + (f.kind ? ' · ' + (f.kind === 'guest' ? 'Guests' : 'Primary registrants') : '') + (f.q ? ' · "' + f.q + '"' : '');
    const pdf = () => { const url = URL.createObjectURL(new Blob([attendeeDoc((ev.name ? ev.name + ': ' : '') + 'Attendees', rows, sub, true)], { type: 'text/html' })), w = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000); setMsg(w ? '' : 'Your browser blocked the report window. Allow pop-ups for this site and try again.'); };
    const excel = () => { const data = xlsx('Attendees', [HEAD, ...rows], [16, 20, 34, 14, 30, 18]);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = slug(ev) + '-attendees.xlsx'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); setMsg('Excel file saved.'); };
    const counts = types.map(t => [t, all.filter(a => a.rt === t).length]);
    return html`<div className=${'attendee-list' + (compact ? ' compact' : '')}>
      <div className="people-toolbar attendee-toolbar">
        <label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Search attendees" placeholder="Search name or company" value=${f.q} onChange=${set('q')}/></label>
        <select aria-label="Registration type" value=${f.rt} onChange=${set('rt')}><option value="">All registration types</option>${types.map(t => html`<option key=${t} value=${t}>${t}</option>`)}</select>
        ${statuses.length > 1 && html`<select aria-label="Invitee status" value=${f.st} onChange=${set('st')}><option value="">All statuses</option>${statuses.map(t => html`<option key=${t} value=${t}>${t}</option>`)}</select>`}
        ${guests && html`<select aria-label="Primary or guest" value=${f.kind} onChange=${set('kind')}><option value="">Primary registrants and guests</option><option value="primary">Primary registrants</option><option value="guest">Guests</option></select>`}
        ${filtered && html`<button type="button" className="btn ghost" onClick=${() => setF({ q: '', rt: '', st: '', kind: '' })}>Clear</button>`}
        <div className="heading-actions"><button type="button" className="btn ghost" disabled=${!rows.length} onClick=${excel}><${Icon} name="download"/>Excel</button><button type="button" className="btn ghost" disabled=${!rows.length} onClick=${pdf}><${Icon} name="print"/>PDF</button></div>
      </div>
      <p className="mute attendee-count" role="status">${filtered ? 'Showing ' + shown.length + ' of ' + plural(all.length, 'attendee') : plural(all.length, 'attendee')}${!filtered && counts.length > 1 ? ' · ' + counts.map(([t, n]) => t + ' ' + n).join(' · ') : ''}${filtered ? '. PDF and Excel include only these.' : ''}</p>
      ${msg && html`<p className="mute export-msg" role="status">${msg}</p>`}
      <div className="data-surface attendee-table"><table className="data-table"><thead><tr>${HEAD.map(h => html`<th key=${h} scope="col">${h}</th>`)}</tr></thead><tbody>
        ${shown.length ? shown.map(a => html`<tr key=${a.id}>${FIELDS.map(([k, label], j) => html`<td key=${k} data-label=${label}>${j < 2 ? html`<b>${a[k]}</b>` : a[k] || html`<span className="mute">–</span>`}</td>`)}</tr>`)
          : html`<tr><td colSpan=${HEAD.length} className="empty-table">${all.length ? 'No attendees match.' : 'No attendees yet.'}</td></tr>`}
      </tbody></table></div>
    </div>`;
  }

  function Importer({ S, A, onClose }) {
    const ev = evOf(current.id);
    const [plan, setPlan] = useState(null), [file, setFile] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(''), [showAll, setShowAll] = useState(false);
    const pick = async e => { const fl = e.target.files[0]; e.target.value = ''; if (!fl) return; setErr(''); setDone('');
      try { const p = planAttendees(await readAllSheets(fl)); if (!p.items.length) throw new Error('The file has a header row but no attendees under it.'); setPlan(p); setFile(fl.name); }
      catch (x) { setPlan(null); setErr(x.message || 'Could not read the file.'); } };
    const items = plan ? plan.items : [], fx = attendeeEffects(items, (S.attendees || []).filter(a => a.ev === current.id));
    const tally = k => fx.filter(x => x.kind === k).length, send = items.filter((x, i) => ['new', 'update'].includes(fx[i].kind));
    const setItem = (i, patch) => setPlan(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, ...patch } : x) }));
    const save = async () => { setBusy(true); setErr('');
      const r = await A.importAttendees(current.id, send.map(x => Object.fromEntries(FIELDS.map(([k]) => [k, x[k]])))); setBusy(false);
      if (r !== false) setDone(tally('new') + ' added, ' + tally('update') + ' updated' + (tally('same') ? ', ' + tally('same') + ' unchanged' : '') + '. No one was removed.');
      else setErr('Could not import. Check the file and try again.'); };
    const rowsShown = items.map((x, i) => [x, fx[i], i]).filter(([, f]) => showAll || f.kind !== 'same');
    return html`<${Modal} title="Import attendees" onClose=${busy ? () => {} : onClose}><div className="rooming-import">
      <p className="mute">For ${ev.name}. Choose the registration report (Excel or CSV) with First Name, Last Name, Company Name, Invitee Status, Primary Registrant (Guest of), and Registration Type. A row whose first and last name match someone already on the list updates that person (when two people share a name, the company decides which); everyone else is added. Nobody is removed.</p>
      <label className="btn ghost file-pick"><${Icon} name="upload"/>${plan ? 'Choose a different file' : 'Choose file'}<input type="file" accept=".xlsx,.csv" onChange=${pick}/></label>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      ${plan && !done && html`
        <p className="import-summary"><b>${file}</b>: ${plural(items.length, 'row')} · ${tally('new')} new · ${tally('update')} updates · ${tally('same')} unchanged${tally('dup') ? ' · ' + tally('dup') + ' repeated' : ''}${tally('skip') ? ' · ' + tally('skip') + ' skipped' : ''}${tally('error') ? ' · ' + tally('error') + ' with problems (left out)' : ''}</p>
        ${plan.missing.length > 0 && html`<p className="warn-text">Not found in the file, left blank: ${plan.missing.join(', ')}.</p>`}
        ${tally('same') > 0 && html`<label className="chk"><input type="checkbox" checked=${showAll} onChange=${e => setShowAll(e.target.checked)}/>Show unchanged rows</label>`}
        <div className="data-surface rooming-table"><table className="data-table"><thead><tr><th scope="col">Name</th><th scope="col">Company</th><th scope="col">Registration</th><th scope="col">Result</th></tr></thead><tbody>
          ${rowsShown.length ? rowsShown.map(([x, f, i]) => html`<tr key=${x.line} className=${'imp-' + f.kind}>
            <td><b>${x.f} ${x.l}</b><span className="cell-secondary">Row ${x.line}</span></td><td>${x.c || html`<span className="mute">–</span>`}</td>
            <td>${x.rt}<span className="cell-secondary">${[x.st, x.g && 'Guest of ' + x.g].filter(Boolean).join(' · ')}</span></td>
            <td>${f.text}${['new', 'update', 'skip'].includes(f.kind) && html`<label className="chk"><input type="checkbox" checked=${!!x.skip} onChange=${e => setItem(i, { skip: e.target.checked })}/>Skip</label>`}</td></tr>`)
            : html`<tr><td colSpan="4" className="empty-table">Everyone in the file is already on the list with the same details.</td></tr>`}
        </tbody></table></div>`}
      ${done && html`<p className="mute" role="status">${done}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>${done ? 'Close' : 'Cancel'}</button>
        ${plan && !done && html`<button type="button" className="btn" disabled=${busy || !send.length} onClick=${save}>${busy ? 'Importing…' : send.length ? 'Import ' + plural(send.length, 'row') : 'Nothing to import'}</button>`}</div>
    </div><//>`;
  }

  // Who besides admins can view this event's list.
  function Viewers({ S, A, onClose }) {
    const ev = evOf(current.id), now = new Set((S.attViewers || []).filter(v => v.ev === current.id).map(v => v.e));
    const [sel, setSel] = useState(now), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
    const pool = people.filter(p => p && !p.gone && p.acct !== 'admin').sort((a, b) => a.name.localeCompare(b.name));
    const shown = pool.filter(p => low(p.name).includes(low(q)) || sel.has(p.id) && !q);
    const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const save = async () => { setBusy(true); setErr(''); const r = await A.setAttendeeViewers(current.id, [...sel]); setBusy(false); if (r !== false) onClose(); else setErr('Could not save. Try again.'); };
    return html`<${Modal} title="Who can view attendees" onClose=${busy ? () => {} : onClose}><div className="attendee-viewers">
      <p className="mute">Admins always see the list. Choose the staff who can view ${ev.name}'s attendee list on their phone or computer; they see every column and can search, filter, and print it. They get a notice when you add them.</p>
      <label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Find a person" placeholder="Find a person" value=${q} onChange=${e => setQ(e.target.value)}/></label>
      <p className="mute">${sel.size ? plural(sel.size, 'person') + ' chosen' : 'No one chosen yet'}</p>
      <div className="viewer-list">${shown.map(p => html`<label key=${p.id} className="chk viewer-row"><input type="checkbox" checked=${sel.has(p.id)} onChange=${() => toggle(p.id)}/><span>${p.name}<span className="cell-secondary">${p.role || ''}</span></span></label>`)}
        ${!shown.length && html`<p className="mute">No one matches.</p>`}</div>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button></div>
    </div><//>`;
  }

  // Admin page.
  function AttendeesAdmin({ S, A }) {
    const all = listOf(S), viewers = (S.attViewers || []).filter(v => v.ev === current.id).map(v => people[v.e]).filter(p => p && !p.gone);
    const [importing, setImporting] = useState(false), [picking, setPicking] = useState(false);
    return html`<div className="attendees-page">
      <div className="attendee-access"><span><b>Who can view:</b> ${viewers.length ? 'Admins and ' + viewers.map(p => p.name).join(', ') : 'Admins only'}</span>
        <span className="heading-actions"><button type="button" className="btn ghost" onClick=${() => setPicking(true)}><${Icon} name="people"/>Who can view</button><button type="button" className="btn" onClick=${() => setImporting(true)}><${Icon} name="upload"/>Import list</button></span></div>
      ${all.length ? html`<${AttendeeList} S=${S}/>` : html`<div className="empty-state"><${Icon} name="contact" size=${28}/><h3>No attendees yet</h3><p className="mute">Import the registration report. Importing again later updates people already on the list and adds new ones.</p><button className="btn" onClick=${() => setImporting(true)}><${Icon} name="upload"/>Import list</button></div>`}
      ${importing && html`<${Importer} S=${S} A=${A} onClose=${() => setImporting(false)}/>`}
      ${picking && html`<${Viewers} S=${S} A=${A} onClose=${() => setPicking(false)}/>`}
    </div>`;
  }

  // Staff home: a card for people chosen to view this event's list.
  function AttendeeCard({ S, me }) {
    const [open, setOpen] = useState(false);
    if (me == null || !(S.attViewers || []).some(v => v.ev === current.id && v.e === me)) return null;
    const n = listOf(S).length, ev = evOf(current.id);
    return html`<div className="card attendee-card"><b><${Icon} name="contact"/> Attendee list</b><p className="mute">${n ? plural(n, 'attendee') + ' for ' + ev.name + '.' : 'The attendee list for ' + ev.name + ' hasn\'t been added yet.'}</p>
      ${n > 0 && html`<div className="acts"><button type="button" className="btn" onClick=${() => setOpen(true)}>Open attendee list</button></div>`}
      ${open && html`<${Modal} title="Attendees" onClose=${() => setOpen(false)}><${AttendeeList} S=${S} compact=${true}/><div className="dialog-actions"><button type="button" className="btn ghost" onClick=${() => setOpen(false)}>Close</button></div><//>`}</div>`;
  }

  return { AttendeesAdmin, AttendeeCard, AttendeeList };
}
