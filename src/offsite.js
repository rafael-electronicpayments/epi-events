// Offsite check-out. Staff (and Admins on the roster, if they want) tap "I'm Offsite" with a reason before leaving
// the property and "I'm Onsite" when back. The event's monitoring admins get a notice and acknowledge the leaving
// one; the person shows as Offsite everywhere until they return. Admins get two reports in People: who is offsite
// now, and the full log (leave and return times, reasons, who acknowledged and when), as PDF or Excel.
import { xlsx } from './xlsx-writer.js';

export const OFFSITE_TYPES = ['staff', 'admin'];
// The open check-out for a person, if any: {e, ev, since}.
export const awayOf = (S, e) => (S.away || []).find(a => a.e === e) || null;
const time = t => t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const stamp = t => t ? new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const mins = (a, b) => { const m = Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const sinceText = a => 'Offsite since ' + time(a.since);

// Rows for the two reports. log: S.offsite for one event.
export function offsiteNowRows(S, people, ev) {
  return (S.offsite || []).filter(l => l.ev === ev && !l.back).sort((a, b) => a.out.localeCompare(b.out))
    .map(l => [people[l.e]?.name || 'Unknown person', stamp(l.out), mins(l.out), l.why, l.oa ? l.oa + ', ' + stamp(l.oat) : 'Not yet acknowledged']);
}
export function offsiteLogRows(S, people, ev) {
  return (S.offsite || []).filter(l => l.ev === ev).sort((a, b) => b.out.localeCompare(a.out))
    .map(l => [people[l.e]?.name || 'Unknown person', stamp(l.out), l.back ? stamp(l.back) : 'Still offsite', mins(l.out, l.back), l.why, l.note || '', l.oa || 'Not acknowledged', l.oat ? stamp(l.oat) : '']);
}
export const NOW_HEAD = ['Person', 'Left', 'Away for', 'Reason', 'Acknowledged by'];
export const LOG_HEAD = ['Person', 'Left', 'Returned', 'Time away', 'Reason', 'Return note', 'Acknowledged by', 'Acknowledged at'];

export function offsiteDoc(title, head, rows, eventName, autoPrint = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{size:letter landscape;margin:.4in}body{font:11px/1.4 system-ui,sans-serif;color:#000;margin:16px}h1{font-size:18px;margin:0 0 2px}.m{color:#555;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:#e8eeed;border-top:0}tr{break-inside:avoid}thead{display:table-header-group}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print or save as PDF</button><h1>${esc(title)}</h1><p class="m">${esc(eventName)} · ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · Printed ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</p>${rows.length ? `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="m">No one.</p>'}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>' : ''}</body></html>`;
}

export function createOffsite({ React, html, Modal, Icon, people, events, current }) {
  const { useState } = React;
  const evOf = id => events.find(e => e.id === id) || {};

  // The staff card: "I'm Offsite" (reason required) and "I'm Onsite" (optional note).
  function OffsiteCard({ S, A, me }) {
    const p = people[me], away = awayOf(S, me), [open, setOpen] = useState(false), [txt, setTxt] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
    if (!p || !OFFSITE_TYPES.includes(p.acct) || !Array.isArray(S.away)) return null;
    const mine = away && (S.offsite || []).find(l => l.e === me && !l.back);
    const ct = (S.offsiteContact || []).find(x => x.ev === current.id)
      || (m => m && people[m.e] ? { n: people[m.e].name, ph: people[m.e].phone || '' } : null)((S.monitors || []).find(x => x.ev === current.id && x.c));
    const go = async e => { e.preventDefault(); setErr('');
      if (!away && !txt.trim()) { setErr('Enter the reason you\'re leaving the property.'); return; }
      setBusy(true); const r = away ? await A.goOnsite(txt.trim()) : await A.goOffsite(current.id, txt.trim()); setBusy(false);
      if (r !== false) { setOpen(false); setTxt(''); } else setErr('Could not save. Try again.'); };
    return html`<div className=${'card offsite-card' + (away ? ' away' : '')}>
      ${away ? html`<b>You're offsite</b><p className="mute">Since ${time(away.since)}${mine ? ' · ' + mine.why : ''}${mine && mine.oa ? ' · acknowledged by ' + mine.oa : ''}</p>`
        : html`<b>Leaving the property?</b><p className="mute">Check out with ${ct ? html`<b>${ct.n}</b>${ct.ph ? html` (<a href=${'tel:' + ct.ph.replace(/[^\d+]/g, '')}>${ct.ph}</a>)` : ''}` : 'your monitor'} before you go, and check back in when you return.</p>`}
      ${open ? html`<form className="offsite-form" onSubmit=${go}>
          <label>${away ? 'Note (optional)' : 'Reason'}<textarea rows="2" maxLength="300" required=${!away} value=${txt} placeholder=${away ? 'Anything your monitor should know' : 'For example: pharmacy run, back by 3 PM'} onChange=${e => setTxt(e.target.value)}></textarea></label>
          ${err && html`<p className="connection-error" role="alert">${err}</p>`}
          <div className="acts"><button type="submit" className="btn" disabled=${busy}>${busy ? 'Saving…' : away ? 'Confirm I\'m Onsite' : 'Confirm I\'m Offsite'}</button><button type="button" className="btn ghost" disabled=${busy} onClick=${() => { setOpen(false); setErr(''); }}>Cancel</button></div></form>`
        : html`<div className="acts"><button type="button" className=${'btn' + (away ? '' : ' offsite-go')} onClick=${() => setOpen(true)}>${away ? 'I\'m Onsite' : 'I\'m Offsite'}</button></div>`}
    </div>`;
  }

  // An offsite notice in someone's list: Acknowledge on the leaving notice, Got it on the return notice.
  const NoticeButton = ({ n, A }) => n.ok === 'out' ? html`<button className="btn" onClick=${() => A.ackOffsite(n.oid)}>Acknowledge</button>`
    : html`<button className="btn ghost" onClick=${() => A.dismiss(n.id)}>Got it</button>`;

  // Admin workspace: this admin's open offsite notices, on every page.
  function OffsiteNotices({ S, A, me }) {
    const list = (S.notes || []).filter(n => n.oid && n.e === me && !n.done);
    if (me == null || !list.length) return null;
    return html`<div className="offsite-notices" role="status">${list.map(n => html`<div key=${n.id} className=${'offsite-notice ' + n.ok}><span><b>${n.ok === 'out' ? 'Offsite' : 'Back onsite'}</b> ${n.x.replace(/^(Offsite|Back onsite): /, '')}</span><${NoticeButton} n=${n} A=${A}/></div>`)}</div>`;
  }

  // People › Offsite reports.
  function OffsiteReports({ S, onClose }) {
    const ev = evOf(current.id), [tab, setTab] = useState('now'), [msg, setMsg] = useState('');
    const now = tab === 'now', head = now ? NOW_HEAD : LOG_HEAD, rows = now ? offsiteNowRows(S, people, ev.id) : offsiteLogRows(S, people, ev.id);
    const title = (ev.name ? ev.name + ': ' : '') + (now ? 'who is offsite now' : 'offsite log');
    const pdf = () => { const url = URL.createObjectURL(new Blob([offsiteDoc(title, head, rows, ev.name || '', true)], { type: 'text/html' })), w = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000); setMsg(w ? '' : 'Your browser blocked the report window. Allow pop-ups for this site and try again.'); };
    const excel = () => { const data = xlsx(now ? 'Offsite now' : 'Offsite log', [head, ...rows], head.map((h, i) => i === 0 ? 24 : h === 'Reason' || h === 'Return note' ? 36 : 22));
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = String(ev.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-') + (now ? '-offsite-now.xlsx' : '-offsite-log.xlsx'); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); setMsg('Excel file saved.'); };
    return html`<${Modal} title="Offsite reports" onClose=${onClose}><div className="offsite-reports">
      <div className="seg" role="group" aria-label="Report"><button type="button" aria-pressed=${now} onClick=${() => setTab('now')}>Who's offsite now</button><button type="button" aria-pressed=${!now} onClick=${() => setTab('log')}>Offsite log</button></div>
      <p className="mute">${now ? 'People checked out as offsite right now, for ' + ev.name + '.' : 'Every check-out for ' + ev.name + ': when they left and returned, the reason, and who acknowledged it.'}</p>
      <div className="data-surface rooming-table"><table className="data-table"><thead><tr>${head.map(h => html`<th key=${h} scope="col">${h}</th>`)}</tr></thead><tbody>
        ${rows.length ? rows.map((r, i) => html`<tr key=${i}>${r.map((c, j) => html`<td key=${j}>${j === 0 ? html`<b>${c}</b>` : c}</td>`)}</tr>`) : html`<tr><td colSpan=${head.length} className="empty-table">${now ? 'No one is offsite.' : 'No one has checked out yet.'}</td></tr>`}
      </tbody></table></div>
      ${msg && html`<p className="mute" role="status">${msg}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className="btn ghost" disabled=${!rows.length} onClick=${excel}><${Icon} name="download"/>Excel</button><button type="button" className="btn" disabled=${!rows.length} onClick=${pdf}><${Icon} name="print"/>PDF</button></div>
    </div><//>`;
  }

  // A small "Offsite" badge next to a name.
  const Badge = ({ S, e }) => { const a = awayOf(S, e); return a ? html`<span className="pill warn offsite-pill" title=${sinceText(a)}>Offsite</span>` : null; };

  return { OffsiteCard, OffsiteNotices, OffsiteReports, NoticeButton, Badge };
}
