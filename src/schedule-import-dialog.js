// Schedule › Import run of show: choose the spreadsheet, resolve names, check rows, then create or update the
// activities in one step (see schedule-import.js for how the sheet is read).
import React from 'react';
import htm from 'htm';
import { Icon, Modal } from './ui.js';
import { readSpreadsheet, planSchedule, rowPeople, scheduleEffect } from './schedule-import.js';

const html = htm.bind(React.createElement);
const hm = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return (h % 12 || 12) + ':' + String(mm).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
const toInput = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const fromInput = v => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
const dayText = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No day';

export function ScheduleImport({ S, A, moments = false, people, events, activities, rooms, current, onClose }) {
  const e0 = events.find(e => e.id === current.id) || {};
  const [plan, setPlan] = React.useState(null), [file, setFile] = React.useState(''), [choice, setChoice] = React.useState({}), [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false), [done, setDone] = React.useState(''), [extend, setExtend] = React.useState(true);
  const pool = people.filter(p => p && !p.gone).sort((a, b) => a.name.localeCompare(b.name));
  const pick = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; setErr(''); setDone('');
    try { const { rows } = await readSpreadsheet(f); const p = planSchedule(rows, people, e0.start, { moments });
      if (!p.items.length) throw new Error('No activities found. The sheet needs a Start / Stop / Event header row and day headings like "THURSDAY, NOVEMBER 12".');
      setPlan(p); setFile(f.name); setChoice(Object.fromEntries(Object.entries(p.unmatched).map(([k, u]) => [k, u.e ?? null]))); }
    catch (x) { setPlan(null); setErr(x.message || 'Could not read the file.'); } };
  const setItem = (i, patch) => setPlan(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const items = plan ? plan.items : [];
  const maxDay = Math.max(-1, ...items.filter(x => !x.skip && x.day != null).map(x => x.day));
  const days = extend && maxDay >= e0.days ? Math.min(14, maxDay + 1) : e0.days;
  const existing = activities.filter(a => a.ev === current.id);
  const fx = items.map(it => { const ppl = rowPeople(it, choice); return { ppl, ...scheduleEffect(it, existing, S.asg || [], days, ppl) }; });
  const ok = items.filter((x, i) => ['new', 'update', 'same'].includes(fx[i].kind));
  const tally = k => fx.filter(f => f.kind === k).length, bad = fx.some(f => f.kind === 'error');
  const roomSet = new Set(rooms.map(r => r.toLowerCase()));
  const newRooms = [...new Set(ok.map(x => x.room).filter(r => !roomSet.has(r.toLowerCase())))];
  const nameOf = id => people[id]?.name || '?';
  const save = async () => { setBusy(true); setErr('');
    const rows = items.map((x, i) => [x, fx[i]]).filter(([, f]) => ['new', 'update', 'same'].includes(f.kind)).map(([x, f]) => ({ title: x.title, room: x.room, day: x.day, start: x.start, end: x.end, det: x.det, leads: f.ppl.leads, members: f.ppl.members }));
    const r = await A.importSchedule(current.id, days > e0.days ? { days } : {}, rows); setBusy(false);
    if (r !== false) setDone(tally('new') + ' activities added, ' + tally('update') + ' updated' + (newRooms.length ? ', ' + newRooms.length + ' new room' + (newRooms.length === 1 ? '' : 's') : '') + '. No pushes were sent; people see their new assignments in the app.');
    else setErr('Could not import. Check the rows and try again.'); };
  const unmatched = plan ? Object.entries(plan.unmatched) : [];
  return html`<${Modal} title="Import run of show" onClose=${busy ? () => {} : onClose}><div className="rooming-import schedule-import">
    <p className="mute">For ${e0.name}. Choose the run-of-show spreadsheet (Excel or CSV). Day headings set each row's date; columns are Start, Stop, Event, Location, Responsibilities, Team Lead, Team Members. A blank location becomes <b>Wyndham Grand Rio Mar</b>; rooms that don't exist are added. "All staff" isn't assigned to everyone: only the team lead (if one is named) is assigned. ${moments ? 'A row with a start and no stop time becomes a one-moment action; Staff needed is the number of people named (none is fine). ' : ''}Re-importing updates activities with the same day and name. No pushes are sent; 30-minute reminders are still scheduled.</p>
    <label className="btn ghost file-pick"><${Icon} name="upload"/>${plan ? 'Choose a different file' : 'Choose file'}<input type="file" accept=".xlsx,.csv" onChange=${pick}/></label>
    ${err && html`<p className="connection-error" role="alert">${err}</p>`}
    ${plan && !done && html`
      <p className="import-summary"><b>${file}</b>: ${items.length} rows · ${tally('new')} new · ${tally('update')} updates · ${tally('same')} no change${tally('skip') ? ' · ' + tally('skip') + ' skipped' : ''}${tally('extend') ? ' · ' + tally('extend') + ' after the event ends' : ''}${bad ? ' · ' + tally('error') + ' to fix' : ''}${newRooms.length ? ' · new rooms: ' + newRooms.join(', ') : ''}</p>
      ${maxDay >= e0.days && html`<label className="chk"><input type="checkbox" checked=${extend} onChange=${e => setExtend(e.target.checked)}/>Extend ${e0.name} to ${Math.min(14, maxDay + 1)} days so the later rows can be imported</label>`}
      ${unmatched.length > 0 && html`<fieldset className="name-fixes"><legend>Names to check <span className="mute">${unmatched.length}</span></legend>
        ${unmatched.map(([k, u]) => html`<label key=${k} className="name-fix"><span><b>${u.raw}</b><span className="cell-secondary ${u.e != null ? 'warn-text' : ''}">${u.how === 'close' ? 'Close match' : u.others.length ? 'Not sure' : 'Not found in People'} · ${u.rows} row${u.rows === 1 ? '' : 's'}</span></span>
          <select aria-label=${'Person for ' + u.raw} value=${choice[k] ?? ''} onChange=${e => setChoice(c => ({ ...c, [k]: e.target.value === '' ? null : Number(e.target.value) }))}>
            <option value="">Leave out</option>${u.others.length > 0 && html`<optgroup label="Suggested">${u.others.map(p => html`<option key=${'o' + p.id} value=${p.id}>${p.name}</option>`)}</optgroup>`}
            <optgroup label="Everyone">${pool.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</optgroup></select></label>`)}</fieldset>`}
      <div className="data-surface rooming-table"><table className="data-table"><thead><tr><th scope="col">When</th><th scope="col">Activity</th><th scope="col">Room</th><th scope="col">Lead</th><th scope="col">Team</th><th scope="col">Result</th></tr></thead><tbody>
      ${items.map((x, i) => { const f = fx[i]; return html`<tr key=${x.line} className=${'imp-' + (f.kind === 'extend' ? 'skip' : f.kind)}>
        <td><b>${dayText(x.date)}</b>${x.allDay ? html`<span className="time-edit"><input type="time" aria-label=${'Start for ' + x.title} value=${toInput(x.start)} onChange=${e => e.target.value && setItem(i, { start: fromInput(e.target.value) })}/>–<input type="time" aria-label=${'Stop for ' + x.title} value=${toInput(x.end % 1440)} onChange=${e => e.target.value && setItem(i, { end: fromInput(e.target.value) || 1440 })}/></span>` : html`<span className="cell-secondary">${x.end === x.start ? hm(x.start) + ' (no end time)' : hm(x.start) + '–' + hm(x.end)}</span>`}</td>
        <td><b>${x.title}</b>${x.det && html`<span className="cell-secondary det-preview">${x.det}</span>`}</td>
        <td><input aria-label=${'Room for ' + x.title} value=${x.room} maxLength="120" onChange=${e => setItem(i, { room: e.target.value, roomDefault: false })}/>${!roomSet.has(x.room.trim().toLowerCase()) && html`<span className="cell-secondary">New room</span>`}${x.roomDefault && html`<span className="cell-secondary">Blank in the sheet</span>`}</td>
        <td>${f.ppl.leads.map(nameOf).join(', ') || html`<span className="mute">–</span>`}</td>
        <td>${f.ppl.members.filter(e => !f.ppl.leads.includes(e)).map(nameOf).join(', ') || html`<span className="mute">–</span>`}${x.all && html`<span className="cell-secondary">All staff: lead only</span>`}</td>
        <td>${f.text}${x.warns.map(w => html`<span key=${w} className="cell-secondary warn-text">${w}</span>`)}
          <label className="chk"><input type="checkbox" checked=${x.skip} onChange=${e => setItem(i, { skip: e.target.checked })}/>Skip</label></td></tr>`; })}
      </tbody></table></div>`}
    ${done && html`<p className="mute" role="status">${done}</p>`}
    <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>${done ? 'Close' : 'Cancel'}</button>
      ${plan && !done && html`<button type="button" className="btn" disabled=${busy || bad || !ok.length} onClick=${save}>${busy ? 'Importing…' : 'Import ' + ok.length + ' activit' + (ok.length === 1 ? 'y' : 'ies')}</button>`}</div>
    ${bad && html`<p className="connection-error" role="alert">Fix or skip the rows marked in red before importing.</p>`}
  </div><//>`;
}
