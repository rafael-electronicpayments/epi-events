// Quick reminders (Manage › Messages): admins send a short message to people working the current event (chosen
// people, or everyone); each person gets an in-app notice and a push, and taps Acknowledge. Admins see who has.
import { typeLabel } from './people-types.js';
export const REMINDER_MAX = 200;
export const QUICK_TEXTS = ['Please acknowledge your assignment in the app.', 'You\'re late for your shift: please check in.', 'Please report to the registration desk.',
  'Please check your updated schedule.', 'Please call your team lead.'];

export function createReminders({ React, html, Modal, Icon, people, events, activities, current }) {
  const { useState } = React;
  const evOf = id => events.find(e => e.id === id) || {};
  const nameOf = e => people[e]?.name || 'Unknown person';
  const when = t => t ? new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  // People assigned to any activity in the event (active only), by name.
  const working = (S, ev) => { const acts = new Set(activities.filter(s => s.ev === ev).map(s => s.id));
    return [...new Set((S.asg || []).filter(a => acts.has(a.s)).map(a => a.e))].map(e => people[e]).filter(p => p && !p.gone).sort((a, b) => a.name.localeCompare(b.name)); };
  const pushCount = (S, ids) => Array.isArray(S.pushStatus) ? ids.filter(e => (S.pushStatus.find(p => p.e === e) || {}).n).length : null;

  function SendReminder({ S, A, preselect, text = '', title = 'Send reminder', onClose, onSent }) {
    const ev = current.id, pool = working(S, ev);
    const [all, setAll] = useState(!preselect), [ids, setIds] = useState(new Set(preselect || [])), [q, setQ] = useState('');
    const [msg, setMsg] = useState(text), [busy, setBusy] = useState(false), [err, setErr] = useState('');
    const to = all ? pool.map(p => p.id) : [...ids].filter(e => people[e] && !people[e].gone), push = pushCount(S, to);
    const toggle = id => setIds(v => { const n = new Set(v); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const send = async e => { e.preventDefault(); setErr('');
      if (!to.length) { setErr('Choose who to send it to.'); return; }
      if (!msg.trim()) { setErr('Write the message.'); return; }
      setBusy(true); const r = await A.sendReminder(ev, to, msg.trim()); setBusy(false);
      if (r !== false) { onSent && onSent(to.length); onClose(); } else setErr('Could not send. Try again.'); };
    return html`<${Modal} title=${title} onClose=${busy ? () => {} : onClose}><form className="reminder-form" onSubmit=${send}>
      <p className="mute">${evOf(ev).name}. They get a notice in the app and, if they turned notifications on, on their phone. They tap Acknowledge to show they got it.</p>
      <fieldset className="choice-list"><legend>To</legend>
        <label className="chk"><input type="radio" name="rem-to" checked=${all} onChange=${() => setAll(true)}/>Everyone working this event · ${pool.length}</label>
        <label className="chk"><input type="radio" name="rem-to" checked=${!all} onChange=${() => setAll(false)}/>Selected people · ${ids.size}</label></fieldset>
      ${!all && html`<fieldset className="break-people"><legend>People <span className="mute">${ids.size} selected</span></legend>
        <div className="break-people-tools"><input type="search" aria-label="Filter people" placeholder="Filter people" value=${q} onChange=${e => setQ(e.target.value)}/>${ids.size > 0 && html`<button type="button" className="btn ghost" onClick=${() => setIds(new Set())}>Clear</button>`}</div>
        <div className="break-people-list">${pool.filter(p => (p.name + ' ' + (p.role || '')).toLowerCase().includes(q.toLowerCase())).map(p => html`<label key=${p.id} className="chk"><input type="checkbox" checked=${ids.has(p.id)} onChange=${() => toggle(p.id)}/>${p.name}<span className="mute">${[typeLabel(p.acct), p.role].filter(Boolean).join(' · ')}</span></label>`)}
          ${!pool.length && html`<p className="mute">No one is assigned to this event yet.</p>`}</div></fieldset>`}
      <div className="quick-texts" role="group" aria-label="Quick texts">${QUICK_TEXTS.map(t => html`<button type="button" key=${t} className="btn ghost quick-text" onClick=${() => setMsg(t)}>${t}</button>`)}</div>
      <label>Message<textarea rows="3" maxLength=${REMINDER_MAX} value=${msg} onChange=${e => setMsg(e.target.value)} placeholder="Short message"></textarea><span className="mute field-hint">${msg.length}/${REMINDER_MAX}</span></label>
      <p className="mute">${to.length} ${to.length === 1 ? 'person' : 'people'}${push != null ? ' · ' + push + ' with notifications on; the others see it next time they open the app' : ''}.</p>
      ${err && html`<p className="connection-error editor-error" role="alert">${err}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="submit" className="btn" disabled=${busy}><${Icon} name="bell"/>${busy ? 'Sending…' : 'Send to ' + to.length}</button></div>
    </form><//>`;
  }

  function MessagesAdmin({ S, A }) {
    const ev = current.id, list = (S.reminders || []).filter(r => r.ev === ev);
    const [send, setSend] = useState(null), [open, setOpen] = useState(null), [msg, setMsg] = useState('');
    return html`<div className="messages-admin">
      <div className="people-toolbar"><span className="mute">${list.length} message${list.length === 1 ? '' : 's'} sent for ${evOf(ev).name}</span>
        <div className="heading-actions"><button className="btn" onClick=${() => setSend({})}><${Icon} name="bell"/>Send reminder</button></div></div>
      ${msg && html`<p className="mute" role="status">${msg}</p>`}
      ${list.length ? html`<div className="data-surface"><table className="data-table"><thead><tr><th scope="col">Message</th><th scope="col">Sent</th><th scope="col">Acknowledged</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.map(r => { const acked = r.to.filter(t => t.ack), waiting = r.to.filter(t => !t.ack); return html`<tr key=${r.id}>
          <td><b>${r.x}</b>${open === r.id && html`<ul className="ack-list">${r.to.slice().sort((a, b) => nameOf(a.e).localeCompare(nameOf(b.e))).map(t => html`<li key=${t.e}><span>${nameOf(t.e)}</span><span className=${t.ack ? 'pill ok' : 'pill warn'}>${t.ack ? 'Acknowledged ' + when(t.ack) : 'Not yet'}</span></li>`)}</ul>`}</td>
          <td>${when(r.at)}<span className="cell-secondary">${r.from}</span></td>
          <td><b>${acked.length} of ${r.to.length}</b><span className="cell-secondary">${waiting.length ? waiting.length + ' waiting' : 'Everyone'}</span></td>
          <td><div className="acts"><button className="btn ghost" aria-expanded=${open === r.id} onClick=${() => setOpen(open === r.id ? null : r.id)}>${open === r.id ? 'Hide' : 'Who'}</button>
            ${waiting.length > 0 && html`<button className="btn ghost" onClick=${() => setSend({ ids: waiting.map(t => t.e), text: r.x, title: 'Remind ' + waiting.length + ' who haven\'t acknowledged' })}>Remind ${waiting.length}</button>`}</div></td></tr>`; })}
      </tbody></table></div>` : html`<p className="mute">No reminders sent for this event yet. Use Send reminder to message everyone working it or chosen people; you'll see who acknowledged here.</p>`}
      ${send && html`<${SendReminder} S=${S} A=${A} preselect=${send.ids} text=${send.text || ''} title=${send.title} onClose=${() => setSend(null)} onSent=${n => setMsg('Sent to ' + n + (n === 1 ? ' person.' : ' people.'))}/>`}
    </div>`;
  }

  return { SendReminder, MessagesAdmin, working };
}
