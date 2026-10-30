// Staff locator (Planning › Staff locator): where everyone is assigned right now, or today, without the activity's
// details or notes: person, their title (team), activity name, room, and time. Admins always see it; admins choose per
// event which other people can see it, and those people get a Staff locator card on their home screen.
const low = v => String(v ?? '').toLowerCase();
const plural = (n, w) => n + ' ' + (n === 1 ? w : w === 'person' ? 'people' : w + 's');

// Admins build the rows from the schedule they already have; others get them from the server (S.locator).
export function locatorRows(S, { admin, people, activities, ev }) {
  const rows = admin
    ? S.asg.map(a => { const s = activities.find(x => x.id === a.s), p = people[a.e];
        return s && p && !p.gone ? { id: a.id, ev: s.ev, e: a.e, n: p.name, tm: p.role || '', t: s.t, r: s.r, d: s.d, a: s.a, b: s.b } : null; }).filter(Boolean)
    : (S.locator || []);
  return rows.filter(x => x.ev === ev);
}
// Every word typed must appear in the person, title, activity or room.
export function locatorFilter(rows, q) {
  const words = low(q).split(/\s+/).filter(Boolean);
  return rows.filter(x => words.every(w => low([x.n, x.tm, x.t, x.r].join(' ')).includes(w)));
}

export function createLocator({ React, html, Modal, Icon, people, activities, events, current, span, todayIndex, nowMinute, dayLabel }) {
  const { useState, useEffect } = React;
  const evOf = id => events.find(e => e.id === id) || {};

  function LocatorList({ S, admin }) {
    const [mode, setMode] = useState('now'), [q, setQ] = useState(''), [, tick] = useState(0);
    useEffect(() => { const t = setInterval(() => tick(x => x + 1), 60000); return () => clearInterval(t); }, []);
    const today = todayIndex(current.id), min = nowMinute(), ev = evOf(current.id);
    const all = locatorRows(S, { admin, people, activities, ev: current.id }).filter(x => x.d === today);
    const live = x => x.a === x.b ? min >= x.a && min < x.a + 15 : min >= x.a && min < x.b;
    const base = mode === 'now' ? all.filter(live) : all;
    const shown = locatorFilter(base, q).sort((x, y) => low(x.n).localeCompare(low(y.n)) || x.a - y.a);
    const running = today >= 0 && today < (ev.days || 0);
    const where = new Set(shown.map(x => x.e)).size;
    return html`<div className="locator">
      <div className="people-toolbar">
        <div className="seg" role="group" aria-label="Show"><button type="button" aria-pressed=${mode === 'now'} onClick=${() => setMode('now')}>Now</button><button type="button" aria-pressed=${mode === 'today'} onClick=${() => setMode('today')}>Today</button></div>
        <label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Search person, team, activity or room" placeholder="Person, team, activity or room" value=${q} onChange=${e => setQ(e.target.value)}/></label>
        <span className="mute">${running ? dayLabel(today) : 'The event isn\'t running today'}</span>
      </div>
      <p className="mute locator-count" role="status">${mode === 'now' ? plural(where, 'person') + ' assigned right now' : plural(shown.length, 'assignment') + ' today, ' + plural(where, 'person')}${q ? ' matching "' + q + '"' : ''}.</p>
      <div className="data-surface locator-table"><table className="data-table"><thead><tr><th scope="col">Person</th><th scope="col">Where</th><th scope="col">Activity</th><th scope="col">Time</th></tr></thead><tbody>
        ${shown.length ? shown.map(x => html`<tr key=${x.id} className=${mode === 'today' && live(x) ? 'locator-live' : ''}>
          <td data-label="Person"><b>${x.n}</b>${x.tm && html`<span className="cell-secondary">${x.tm}</span>`}</td>
          <td data-label="Where"><b>${x.r}</b></td><td data-label="Activity">${x.t}</td>
          <td data-label="Time">${span(x)}${mode === 'today' && live(x) && html` <span className="pill ok">Now</span>`}</td></tr>`)
          : html`<tr><td colSpan="4" className="empty-table">${!running ? 'No assignments today.' : q ? 'No one matches "' + q + '".' : mode === 'now' ? 'No one is assigned right now.' : 'No assignments today.'}</td></tr>`}
      </tbody></table></div>
    </div>`;
  }

  function Viewers({ S, A, onClose }) {
    const ev = evOf(current.id), now = new Set((S.locViewers || []).filter(v => v.ev === current.id).map(v => v.e));
    const [sel, setSel] = useState(now), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
    const pool = people.filter(p => p && !p.gone && p.acct !== 'admin').sort((a, b) => a.name.localeCompare(b.name));
    const shown = pool.filter(p => low(p.name).includes(low(q)));
    const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const save = async () => { setBusy(true); setErr(''); const r = await A.setLocatorViewers(current.id, [...sel]); setBusy(false); if (r !== false) onClose(); else setErr('Could not save. Try again.'); };
    return html`<${Modal} title="Who can use the staff locator" onClose=${busy ? () => {} : onClose}><div className="attendee-viewers">
      <p className="mute">Admins always can. Choose who else can see where everyone is assigned for ${ev.name}, now and today. They see each person's title, room, activity name, and time, but not the activity's details or notes. They get a notice when you add them.</p>
      <label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Find a person" placeholder="Find a person" value=${q} onChange=${e => setQ(e.target.value)}/></label>
      <p className="mute">${sel.size ? plural(sel.size, 'person') + ' chosen' : 'No one chosen yet'}</p>
      <div className="viewer-list">${shown.map(p => html`<label key=${p.id} className="chk viewer-row"><input type="checkbox" checked=${sel.has(p.id)} onChange=${() => toggle(p.id)}/><span>${p.name}<span className="cell-secondary">${p.role || ''}</span></span></label>`)}
        ${!shown.length && html`<p className="mute">No one matches.</p>`}</div>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button></div>
    </div><//>`;
  }

  function LocatorAdmin({ S, A }) {
    const [picking, setPicking] = useState(false);
    const viewers = (S.locViewers || []).filter(v => v.ev === current.id).map(v => people[v.e]).filter(p => p && !p.gone);
    return html`<div>
      <div className="attendee-access"><span><b>Who can use it:</b> ${viewers.length ? 'Admins and ' + viewers.map(p => p.name).join(', ') : 'Admins only'}</span>
        <span className="heading-actions"><button type="button" className="btn ghost" onClick=${() => setPicking(true)}><${Icon} name="people"/>Who can use it</button></span></div>
      <${LocatorList} S=${S} admin=${true}/>
      ${picking && html`<${Viewers} S=${S} A=${A} onClose=${() => setPicking(false)}/>`}
    </div>`;
  }

  // Home screen card for people given access.
  function LocatorCard({ S, me }) {
    const [open, setOpen] = useState(false);
    if (me == null || !(S.locViewers || []).some(v => v.ev === current.id && v.e === me)) return null;
    return html`<div className="card locator-card"><b><${Icon} name="locate"/> Staff locator</b><p className="mute">See where everyone is assigned right now, or today.</p>
      <div className="acts"><button type="button" className="btn" onClick=${() => setOpen(true)}>Open staff locator</button></div>
      ${open && html`<${Modal} title="Staff locator" onClose=${() => setOpen(false)}><${LocatorList} S=${S} admin=${!Array.isArray(S.locator)}/><div className="dialog-actions"><button type="button" className="btn ghost" onClick=${() => setOpen(false)}>Close</button></div><//>`}</div>`;
  }

  return { LocatorAdmin, LocatorCard, LocatorList };
}
