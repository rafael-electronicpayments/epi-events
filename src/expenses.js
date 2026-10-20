// Expense entry (staff, contractors, roster admins) and admin review/approval with an HR report.
// Fields follow EPI's expense template: Expense, Location, Receipt ID, Date, Amount, Payment method, Reimburse, Notes.

export const CATS = [['breakfast', 'Meal: Breakfast'], ['lunch', 'Meal: Lunch'], ['dinner', 'Meal: Dinner'], ['baggage', 'Baggage'], ['transportation', 'Transportation'], ['parking', 'Parking'], ['other', 'Other']];
export const PAYS = [['cash', 'Cash'], ['corporate_amex', 'Corporate AMEX'], ['personal_card', 'Personal credit card'], ['guest_room', 'Billed to guest room']];
export const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
export const RECEIPT_MAX = 10485760;
const label = (list, k) => (list.find(([v]) => v === k) || [k, k])[1];
export const catText = k => label(CATS, k), payText = k => label(PAYS, k);
export const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const dateText = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
const cents = n => Math.round(Number(n || 0) * 100);
export const sum = list => list.reduce((t, x) => t + cents(x.amt), 0) / 100;
// Browsers report some iPhone photos without a type; infer from the name.
export const receiptType = f => f.type && RECEIPT_TYPES[f.type] ? f.type : ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' })[(f.name.split('.').pop() || '').toLowerCase()] || '';

// Same rules as the database, so people see problems before saving.
export function checkExpense(o) {
  if (!CATS.some(([k]) => k === o.cat)) return 'Choose an expense type.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) return 'Enter the expense date.';
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(o.amt || '') || !(Number(o.amt) > 0)) return 'Enter an amount greater than zero (up to two decimals).';
  if (!PAYS.some(([k]) => k === o.pay)) return 'Choose a payment method.';
  if (o.cat === 'other' && !String(o.notes || '').trim()) return 'Add a note describing this expense.';
  return '';
}

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Printable HR report: grouped by person, totals per person and overall, approved and unapproved marked.
export function hrReport({ list, people, eventName, scope, title, autoPrint = false }) {
  const heading = title || eventName + ': expense report';
  const byPerson = [...new Set(list.map(x => x.e))].map(e => ({ e, p: people[e] || { name: 'Unknown person', role: '' }, items: list.filter(x => x.e === e).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id) }))
    .sort((a, b) => a.p.name.localeCompare(b.p.name));
  const totals = items => ({ all: sum(items), ok: sum(items.filter(x => x.ok)), pending: sum(items.filter(x => !x.ok)), reimb: sum(items.filter(x => x.reimb)) });
  const tline = (t, cls) => `<tr class="${cls}"><td colspan="7">Total ${esc(money(t.all))} · Approved ${esc(money(t.ok))} · Not yet approved ${esc(money(t.pending))} · To reimburse ${esc(money(t.reimb))}</td><td class="r">${esc(money(t.all))}</td><td></td></tr>`;
  const body = byPerson.map(g => `<section><h2>${esc(g.p.name)}${g.p.role ? ` <span class="m">${esc(g.p.role)}</span>` : ''}</h2><table><thead><tr><th class="d">Date</th><th>Expense</th><th>Location</th><th>Receipt ID</th><th>Payment</th><th class="c">Reimburse</th><th>Notes</th><th class="r">Amount</th><th class="s">Status</th></tr></thead><tbody>${g.items.map(x => `<tr><td class="d">${esc(dateText(x.date))}</td><td>${esc(catText(x.cat))}</td><td>${esc(x.loc)}</td><td>${esc(x.ref)}</td><td>${esc(payText(x.pay))}</td><td class="c">${x.reimb ? 'Y' : 'N'}</td><td>${esc(x.notes)}</td><td class="r">${esc(money(x.amt))}</td><td class="s ${x.ok ? 'ok' : 'pend'}">${x.ok ? 'Approved' : 'Not approved'}</td></tr>`).join('')}${tline(totals(g.items), 'sub')}</tbody></table></section>`).join('');
  const all = totals(list);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title><style>@page{size:letter landscape;margin:.4in}body{font:11px/1.35 system-ui,sans-serif;color:#000;margin:16px}h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 4px;break-after:avoid}.m{color:#555;font-weight:400}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border-top:1px solid #bbb;padding:4px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:#e8eeed}.d{width:11%}.c{width:7%;text-align:center}.r{width:9%;text-align:right}.s{width:10%}.ok{color:#05603a;font-weight:600}.pend{color:#93370d;font-weight:600}tr.sub td{background:#f3f6f5;font-weight:600}tr{break-inside:avoid}section{break-inside:auto}.grand{margin-top:18px;padding:8px 10px;border:2px solid #0f766e;font-size:13px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print or save as PDF</button><h1>${esc(heading)}</h1><p class="m">${esc(scope)} · ${list.length} expense${list.length === 1 ? '' : 's'} · ${byPerson.length} ${byPerson.length === 1 ? 'person' : 'people'} · Printed ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</p>${body || '<p class="m">No expenses match.</p>'}${list.length ? `<p class="grand"><b>All people: ${esc(money(all.all))}</b> · Approved ${esc(money(all.ok))} · Not yet approved ${esc(money(all.pending))} · To reimburse ${esc(money(all.reimb))}</p>` : ''}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>' : ''}</body></html>`;
}

export function createExpenses({ React, html, Modal, Icon, IconButton, people, events, current }) {
  const { useState } = React;
  const today = () => { const d = new Date(), q = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + q(d.getMonth() + 1) + '-' + q(d.getDate()); };
  const field = (text, input, hint) => html`<label>${text}${input}${hint && html`<span className="mute field-hint">${hint}</span>`}</label>`;
  const Status = ({ x }) => html`<span className=${'pill ' + (x.ok ? 'ok' : 'warn')}>${x.ok ? 'Approved' : 'Pending approval'}</span>`;
  // Personal report: one person's expenses for the current event, approved and not yet approved.
  const printPerson = (S, e) => {
    const ev = events.find(x => x.id === current.id), name = people[e]?.name || 'Unknown person';
    const list = (S.expenses || []).filter(x => x.e === e && x.ev === current.id);
    const doc = hrReport({ list, people, eventName: ev ? ev.name : '', title: (ev ? ev.name + ': ' : '') + 'expenses for ' + name, scope: 'All expenses for this event, approved and not yet approved', autoPrint: true });
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' })), w = window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return w ? '' : 'Your browser blocked the report window. Allow pop-ups for this site and try again.';
  };
  const openReceipt = async (A, x, setMsg) => {
    // Open the tab during the click so pop-up blockers allow it, then load the file into it.
    const w = window.open('', '_blank');
    try { const { data, type } = await A.receiptFile(x); const url = URL.createObjectURL(new Blob([data], { type })); if (w) w.location.href = url; else window.location.assign(url); setTimeout(() => URL.revokeObjectURL(url), 120000); }
    catch (e) { if (w) w.close(); setMsg && setMsg('Could not open the receipt.'); }
  };

  function ExpenseEditor({ editor, A, onClose, chooser = false }) {
    const x = editor.x;
    const [d, setD] = useState(() => x ? { cat: x.cat, loc: x.loc, ref: x.ref, date: x.date, amt: String(Number(x.amt).toFixed(2)), pay: x.pay, reimb: !!x.reimb, notes: x.notes }
      : { cat: 'lunch', loc: '', ref: '', date: editor.date || today(), amt: '', pay: 'personal_card', reimb: true, notes: '' });
    const [who, setWho] = useState(x ? x.e : editor.e ?? '');
    const [file, setFile] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
    const set = k => e => setD(v => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    const pick = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const t = receiptType(f);
      if (!t) { setErr('Receipts must be a photo (JPG, PNG, HEIC, WebP) or a PDF.'); return; }
      if (f.size > RECEIPT_MAX) { setErr('Receipts must be 10 MB or smaller.'); return; }
      setErr(''); setFile({ f, type: t }); };
    const submit = async e => { e.preventDefault(); const o = { ...d, amt: d.amt.trim().replace(/^\$/, '').replace(/,/g, ''), loc: d.loc.trim(), ref: d.ref.trim(), notes: d.notes.trim() };
      const m = checkExpense(o) || (chooser && !x && who === '' ? 'Choose who this expense is for.' : '') || (!file && !(x && x.rp) ? 'Attach a photo or PDF of the receipt before saving.' : ''); if (m) { setErr(m); return; }
      setBusy(true); setErr('');
      const data = file ? new Uint8Array(await file.f.arrayBuffer()) : null;
      const r = await A.saveExpense(x ? x.id : null, chooser && !x ? { ...o, e: Number(who) } : o, data ? { data, type: file.type } : null, false);
      setBusy(false); if (r !== false) onClose(); else setErr('Could not save. Check the values and try again.'); };
    const active = people.filter(p => p && !p.gone).sort((a, b) => a.name.localeCompare(b.name));
    return html`<${Modal} title=${x ? 'Edit expense' : 'Add expense'} onClose=${busy ? () => {} : onClose}><form className="expense-editor" onSubmit=${submit}>
      <div className="editor-fields">
       ${chooser && !x && field('Person', html`<select required value=${who} onChange=${e => setWho(e.target.value)}><option value="" disabled>Choose person</option>${active.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</select>`)}
       ${field('Expense', html`<select value=${d.cat} onChange=${set('cat')}>${CATS.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`)}
       ${field('Location', html`<input value=${d.loc} maxLength="200" placeholder="Merchant, e.g. Starbucks" onChange=${set('loc')}/>`)}
       ${field('Date', html`<input type="date" required value=${d.date} onChange=${set('date')}/>`)}
       ${field('Amount (USD)', html`<input inputMode="decimal" required value=${d.amt} placeholder="0.00" onChange=${set('amt')}/>`)}
       ${field('Receipt ID', html`<input value=${d.ref} maxLength="100" placeholder="Number printed on the receipt" onChange=${set('ref')}/>`)}
       ${field('Payment method', html`<select value=${d.pay} onChange=${set('pay')}>${PAYS.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`)}
       <label className="chk"><input type="checkbox" checked=${d.reimb} onChange=${set('reimb')}/>Reimburse me for this expense</label>
       ${field('Notes', html`<textarea rows="3" maxLength="1000" value=${d.notes} onChange=${set('notes')}></textarea>`, d.cat === 'other' ? 'Required: describe the expense (for example gas, mileage, tolls).' : ['breakfast', 'lunch', 'dinner'].includes(d.cat) ? 'List others included, or note team, ISO hosting, or personal meal.' : d.cat === 'transportation' ? 'For example: Uber from A to B, rental car.' : '')}
      </div>
      <div className="receipt-field"><b>Receipt <span className="required-tag">Required</span></b>
       ${file ? html`<p>${file.f.name} <span className="mute">(${file.type === 'application/pdf' ? 'PDF' : 'photo'}, ready to upload)</span> <button type="button" className="btn ghost" onClick=${() => setFile(null)}>Remove</button></p>`
        : x && x.rp ? html`<p><button type="button" className="btn ghost" onClick=${() => openReceipt(A, x, setErr)}><${Icon} name="eye"/>View current receipt</button></p>`
        : html`<p className="receipt-missing">No receipt attached yet. Attach a photo or PDF to save this expense.</p>`}
       <label className="btn ghost file-pick"><${Icon} name="upload"/>${file || (x && x.rp) ? 'Replace with photo or PDF' : 'Attach photo or PDF'}<input type="file" accept="image/*,application/pdf,.heic,.heif" onChange=${pick}/></label>
       <p className="mute field-hint">Take a photo of the receipt or choose a PDF (10 MB max). Only you and administrators can see it.</p>
      </div>
      ${err && html`<p className="connection-error editor-error" role="alert">${err}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="submit" className="btn" disabled=${busy}>${busy ? 'Saving…' : x ? 'Save changes' : 'Add expense'}</button></div>
    </form><//>`;
  }

  // "My expenses" card on the staff/contractor screen (and an admin's My schedule).
  function ExpenseSection({ S, A, me }) {
    const [ed, setEd] = useState(null), [confirm, setConfirm] = useState(null), [msg, setMsg] = useState('');
    const ev = events.find(e => e.id === current.id);
    const mine = (S.expenses || []).filter(x => x.e === me && x.ev === current.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return html`<div className="card expense-card"><div className="expense-head"><b>My expenses</b><span className="mute">${mine.length ? money(sum(mine)) + ' · ' + mine.filter(x => x.ok).length + ' of ' + mine.length + ' approved' : ev ? ev.name : ''}</span></div>
     ${mine.length ? html`<ul className="expense-list">${mine.map(x => html`<li key=${x.id}><div className="expense-main"><b>${catText(x.cat)}${x.loc ? ' · ' + x.loc : ''}</b><span className="mute">${dateText(x.date)} · ${payText(x.pay)}${x.reimb ? ' · reimburse' : ''}</span></div>
       <div className="expense-side"><b>${money(x.amt)}</b><${Status} x=${x}/></div>
       <div className="acts">${x.rp && html`<button className="btn ghost" onClick=${() => openReceipt(A, x, setMsg)}>Receipt</button>`}
        ${!x.ok && html`<button className="btn ghost" onClick=${() => setEd({ x })}>Edit</button>${confirm === x.id ? html`<button className="btn danger" onClick=${async () => { setConfirm(null); await A.delExpense(x.id); }}>Confirm delete</button><button className="btn ghost" onClick=${() => setConfirm(null)}>Keep</button>` : html`<button className="btn ghost" onClick=${() => setConfirm(x.id)}>Delete</button>`}`}</div></li>`)}</ul>`
      : html`<p className="mute">Add each expense as it happens, with a photo of the receipt. Your administrator approves them.</p>`}
     ${msg && html`<p className="mute" role="status">${msg}</p>`}
     <div className="acts"><button className="btn" onClick=${() => setEd({ x: null, e: me, date: today() })}><${Icon} name="plus"/>Add expense</button>${mine.length > 0 && html`<button className="btn ghost" onClick=${() => setMsg(printPerson(S, me))}><${Icon} name="print"/>Print my expenses</button>`}</div>
     ${ed && html`<${ExpenseEditor} editor=${ed} A=${A} onClose=${() => setEd(null)}/>`}</div>`;
  }

  // Admin review: grouped by person, tick to approve, HR report.
  function ExpensesAdmin({ S, A, table, actions, onReport }) {
    const [status, setStatus] = useState('all'), [who, setWho] = useState('all'), [ed, setEd] = useState(null), [del, setDel] = useState(null), [msg, setMsg] = useState('');
    const all = (S.expenses || []).filter(x => x.ev === current.id);
    const list = all.filter(x => (status === 'all' || (status === 'ok') === !!x.ok) && (who === 'all' || x.e === Number(who)));
    const groups = [...new Set(list.map(x => x.e))].map(e => ({ e, p: people[e] || { name: 'Unknown person', role: '' }, items: list.filter(x => x.e === e).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id) })).sort((a, b) => a.p.name.localeCompare(b.p.name));
    const filers = [...new Set(all.map(x => x.e))].filter(e => people[e]).sort((a, b) => people[a].name.localeCompare(people[b].name));
    const scope = (status === 'all' ? 'Approved and not yet approved' : status === 'ok' ? 'Approved only' : 'Not yet approved only') + (who === 'all' ? '' : ' · ' + (people[Number(who)]?.name || ''));
    return html`<div className="expenses-admin">
     <div className="summary-strip expense-summary"><div><b>${money(sum(all))}</b>total</div><div><b>${money(sum(all.filter(x => x.ok)))}</b>approved</div><div><b>${all.filter(x => !x.ok).length}</b>awaiting approval</div><div><b>${money(sum(all.filter(x => x.reimb)))}</b>to reimburse</div></div>
     <div className="people-toolbar"><select aria-label="Approval status" value=${status} onChange=${e => setStatus(e.target.value)}><option value="all">All expenses</option><option value="pending">Awaiting approval</option><option value="ok">Approved</option></select>
      <select aria-label="Person" value=${who} onChange=${e => setWho(e.target.value)}><option value="all">Everyone</option>${filers.map(e => html`<option key=${e} value=${e}>${people[e].name}</option>`)}</select>
      <span className="mute">${list.length} shown</span><div className="heading-actions"><button className="btn ghost" disabled=${!list.length} onClick=${() => setMsg(onReport(list, scope))}><${Icon} name="print"/>HR report (PDF)</button><button className="btn" onClick=${() => setEd({ x: null })}><${Icon} name="plus"/>Add expense</button></div></div>
     ${msg && html`<p className="mute" role="status">${msg}</p>`}
     ${groups.length ? groups.map(g => { const ok = g.items.filter(x => x.ok);
       return html`<section key=${g.e} className="expense-group"><div className="section-heading"><h3>${g.p.name} <span className="mute">${g.p.role || ''}</span></h3><span className="group-actions"><span className="mute">${money(sum(g.items))} total · ${money(sum(ok))} approved · ${money(sum(g.items.filter(x => x.reimb)))} to reimburse</span><button className="btn ghost" onClick=${() => setMsg(printPerson(S, g.e))} aria-label=${'Print expense report for ' + g.p.name}><${Icon} name="print"/>Print</button></span></div>
        ${table([{ text: 'Approved', className: 'approve-col' }, { text: 'Date' }, { text: 'Expense' }, { text: 'Location / receipt ID' }, { text: 'Payment' }, { text: 'Notes' }, { text: 'Amount', className: 'amount-col' }, { text: '', className: 'setup-actions' }],
          g.items.map(x => html`<tr key=${x.id}><td className="approve-col"><input type="checkbox" aria-label=${'Approve ' + catText(x.cat) + ' ' + money(x.amt) + ' for ' + g.p.name} checked=${!!x.ok} onChange=${e => A.approveExpense(x.id, e.target.checked)}/></td>
           <td>${dateText(x.date)}</td><td>${catText(x.cat)}</td><td>${x.loc || html`<span className="mute">No location</span>`}<span className="cell-secondary">${x.ref ? 'Receipt ' + x.ref : 'No receipt ID'}</span></td>
           <td>${payText(x.pay)}<span className="cell-secondary">${x.reimb ? 'Reimburse' : 'No reimbursement'}</span></td><td className="notes-col">${x.notes}</td><td className="amount-col"><b>${money(x.amt)}</b></td>
           <td className="setup-actions"><div className="row-actions">${x.rp && html`<${IconButton} name="eye" label=${'View receipt for ' + catText(x.cat) + ' ' + money(x.amt)} onClick=${() => openReceipt(A, x, setMsg)}/>`}<${IconButton} name="edit" label=${'Edit ' + catText(x.cat) + ' ' + money(x.amt)} onClick=${() => setEd({ x })}/>${del === x.id ? html`<button className="btn danger" onClick=${async () => { setDel(null); await A.delExpense(x.id); }}>Confirm</button>` : html`<${IconButton} name="delete" label=${'Delete ' + catText(x.cat) + ' ' + money(x.amt)} onClick=${() => setDel(x.id)}/>`}</div></td></tr>`))}
       </section>`; })
      : html`<div className="empty-state"><${Icon} name="receipt" size=${28}/><h3>${all.length ? 'No expenses match these filters' : 'No expenses yet'}</h3><p className="mute">Staff and contractors add expenses from their own screen.</p></div>`}
     ${ed && html`<${ExpenseEditor} editor=${ed} A=${A} chooser=${true} onClose=${() => setEd(null)}/>`}
    </div>`;
  }

  return { ExpenseEditor, ExpenseSection, ExpensesAdmin };
}
