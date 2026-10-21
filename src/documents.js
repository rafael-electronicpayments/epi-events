// Documents: each event has its own files. Admins add, edit (name and who can view), and delete them; everyone else
// sees, opens, and downloads the documents meant for them (server-enforced in connected mode).

export const DOC_MAX = 26214400; // 25 MB; the documents bucket enforces the same limit
export const DOC_TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain'
};
const EXT = Object.fromEntries(Object.entries(DOC_TYPES).reverse().map(([e, t]) => [t, e]));
export const docExt = type => EXT[type] || 'bin';
const ext = name => (String(name).split('.').pop() || '').toLowerCase();
// The file's type, from its name first (browsers often leave Office types blank); '' if not allowed.
export const docType = f => DOC_TYPES[ext(f.name)] || (Object.values(DOC_TYPES).includes(f.type) ? f.type : '');
export const kindText = t => ({ 'application/pdf': 'PDF', 'text/csv': 'CSV', 'text/plain': 'Text' })[t]
  || (t.startsWith('image/') ? 'Image' : /word/.test(t) ? 'Word' : /excel|sheet/.test(t) ? 'Excel' : /powerpoint|presentation/.test(t) ? 'PowerPoint' : 'File');
export const sizeText = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const viewable = t => t === 'application/pdf' || t === 'text/plain' || t === 'text/csv' || /^image\/(png|jpeg|webp)$/.test(t);
const fileName = d => /\.[a-z0-9]{1,5}$/i.test(d.name) ? d.name : d.name + '.' + docExt(d.type);

// Open in a new tab (the tab is opened during the click so pop-up blockers allow it) or save to the device.
export async function openDocument(A, d) {
  const w = window.open('', '_blank');
  try {
    const data = await A.documentFile(d), url = URL.createObjectURL(new Blob([data], { type: d.type }));
    if (w) w.location.href = url; else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120000); return '';
  } catch (e) { if (w) w.close(); return 'Could not open ' + d.name + '. Try again.'; }
}
export async function downloadDocument(A, d) {
  try {
    const data = await A.documentFile(d), url = URL.createObjectURL(new Blob([data], { type: d.type }));
    const a = document.createElement('a'); a.href = url; a.download = fileName(d); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000); return '';
  } catch (e) { return 'Could not download ' + d.name + '. Try again.'; }
}

export function createDocuments({ React, html, Modal, Icon, people, events, activities, current }) {
  const { useState } = React;
  const field = (text, input, hint) => html`<label>${text}${input}${hint && html`<span className="mute field-hint">${hint}</span>`}</label>`;
  const eventPeople = (S, ev) => { const acts = new Set(activities.filter(s => s.ev === ev).map(s => s.id)); return new Set((S.asg || []).filter(a => acts.has(a.s)).map(a => a.e)); };
  const whoText = (S, d) => {
    if (d.all) return 'Everyone working this event';
    const names = (d.who || []).map(e => people[e]?.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return names.length ? names.length + (names.length === 1 ? ' person: ' : ' people: ') + names.join(', ') : 'Nobody selected';
  };

  // Add (with a file) or edit (name and who can view). Same people picker as Add lunch or break.
  function DocumentEditor({ doc, S, A, onClose }) {
    const ev = doc ? doc.ev : current.id, working = eventPeople(S, ev);
    const [file, setFile] = useState(null), [name, setName] = useState(doc ? doc.name : '');
    const [all, setAll] = useState(doc ? !!doc.all : true), [ids, setIds] = useState(new Set(doc && !doc.all ? doc.who || [] : []));
    const [q, setQ] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
    const active = people.filter(p => p && !p.gone).sort((x, y) => (working.has(y.id) - working.has(x.id)) || x.name.localeCompare(y.name));
    const evActs = activities.filter(s => s.ev === ev).sort((x, y) => x.d - y.d || x.a - y.a);
    const toggle = id => setErr('') || setIds(v => { const n = new Set(v); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const addFrom = sid => { const s = activities.find(x => x.id === Number(sid)); if (!s) return; setIds(v => new Set([...v, ...(S.asg || []).filter(a => a.s === s.id && people[a.e] && !people[a.e].gone).map(a => a.e)])); };
    const pick = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const t = docType(f);
      if (!t) { setErr('This file type can\'t be added. Use PDF, Word, Excel, PowerPoint, CSV, text, or an image.'); return; }
      if (f.size > DOC_MAX) { setErr(f.name + ' is ' + sizeText(f.size) + '. Documents must be 25 MB or smaller.'); return; }
      if (!f.size) { setErr(f.name + ' is empty.'); return; }
      setErr(''); setFile({ f, type: t }); if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, '')); };
    const submit = async e => { e.preventDefault(); setErr('');
      if (!doc && !file) { setErr('Choose a file to add.'); return; }
      if (!name.trim()) { setErr('Enter a document name.'); return; }
      if (!all && !ids.size) { setErr('Choose at least one person, or let everyone working this event view it.'); return; }
      setBusy(true);
      const r = doc ? await A.editDocument(doc.id, name.trim(), all, [...ids])
        : await A.addDocument(ev, { name: name.trim(), data: new Uint8Array(await file.f.arrayBuffer()), size: file.f.size, type: file.type }, all, [...ids]);
      setBusy(false); if (r !== false) onClose(); else setErr('Could not save. Check the values and try again.'); };
    const evName = (events.find(x => x.id === ev) || {}).name || '';
    return html`<${Modal} title=${doc ? 'Edit document' : 'Add document'} onClose=${busy ? () => {} : onClose}><form className="break-editor document-editor" onSubmit=${submit}>
      ${!doc && html`<div className="receipt-field"><b>File</b>
        ${file ? html`<p>${file.f.name} <span className="mute">(${kindText(file.type)}, ${sizeText(file.f.size)})</span> <button type="button" className="btn ghost" onClick=${() => setFile(null)}>Remove</button></p>` : html`<p className="mute">PDF, Word, Excel, PowerPoint, CSV, text, or an image, up to 25 MB.</p>`}
        <label className="btn ghost file-pick"><${Icon} name="upload"/>${file ? 'Choose a different file' : 'Choose file'}<input type="file" accept=${Object.keys(DOC_TYPES).map(x => '.' + x).join(',')} disabled=${busy} onChange=${pick}/></label></div>`}
      <div className="editor-fields">${field('Document name', html`<input required maxLength="200" value=${name} onChange=${e => setName(e.target.value)}/>`, 'Shown to the people who can view it, for ' + evName + '.')}</div>
      <fieldset className="choice-list"><legend>Who can view and download</legend>
        <label className="chk"><input type="radio" name="doc-who" checked=${all} onChange=${() => setAll(true)}/>Everyone working this event</label>
        <label className="chk"><input type="radio" name="doc-who" checked=${!all} onChange=${() => setAll(false)}/>Only the people I select</label>
      </fieldset>
      ${!all && html`<fieldset className="break-people"><legend>People <span className="mute">${ids.size} selected</span></legend>
        <div className="break-people-tools"><select aria-label="Add everyone assigned to an activity" value="" onChange=${e => addFrom(e.target.value)}><option value="">Add everyone in an activity…</option>${evActs.map(s => html`<option key=${s.id} value=${s.id}>${s.t}, ${s.r}</option>`)}</select>
          <input type="search" aria-label="Filter people" placeholder="Filter people" value=${q} onChange=${e => setQ(e.target.value)}/>${ids.size > 0 && html`<button type="button" className="btn ghost" onClick=${() => setIds(new Set())}>Clear</button>`}</div>
        <div className="break-people-list">${active.filter(p => (p.name + ' ' + (p.role || '')).toLowerCase().includes(q.toLowerCase())).map(p => html`<label key=${p.id} className="chk"><input type="checkbox" checked=${ids.has(p.id)} onChange=${() => toggle(p.id)}/>${p.name}<span className="mute">${working.has(p.id) ? p.role || '' : 'Not on this event'}</span></label>`)}</div>
        <p className="mute field-hint">People see a document only once they're assigned to an activity in this event.</p>
      </fieldset>`}
      ${err && html`<p className="connection-error editor-error" role="alert">${err}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="submit" className="btn" disabled=${busy}>${busy ? (doc ? 'Saving…' : 'Uploading…') : doc ? 'Save changes' : 'Add document'}</button></div>
    </form><//>`;
  }

  // Admin page: the current event's documents.
  function DocumentsAdmin({ S, A, adding, onAdded }) {
    const [ed, setEd] = useState(null), [gone, setGone] = useState(null), [msg, setMsg] = useState('');
    const list = (S.documents || []).filter(d => d.ev === current.id);
    const editor = adding ? { doc: null } : ed;
    const close = () => { setEd(null); if (adding) onAdded(); };
    return html`<div className="documents-admin">
      ${msg && html`<p className="connection-error" role="alert">${msg}</p>`}
      ${list.length ? html`<div className="data-surface"><table className="data-table"><thead><tr><th scope="col">Document</th><th scope="col">Who can view</th><th scope="col" className="doc-actions-col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.map(d => html`<tr key=${d.id}><td><b>${d.name}</b><span className="cell-secondary">${kindText(d.type)} · ${sizeText(d.size)}</span></td><td className="doc-who">${whoText(S, d)}</td>
          <td><div className="acts doc-acts">${viewable(d.type) && html`<button className="btn ghost" onClick=${async () => setMsg(await openDocument(A, d))}><${Icon} name="eye"/>Open</button>`}<button className="btn ghost" onClick=${async () => setMsg(await downloadDocument(A, d))}><${Icon} name="download"/>Download</button><button className="btn ghost" onClick=${() => setEd({ doc: d })}><${Icon} name="edit"/>Edit</button>
            ${gone === d.id ? html`<button className="btn danger" onClick=${async () => { setGone(null); await A.delDocument(d.id); }}>Confirm delete</button><button className="btn ghost" onClick=${() => setGone(null)}>Keep</button>` : html`<button className="btn ghost" onClick=${() => setGone(d.id)}><${Icon} name="delete"/>Delete</button>`}</div></td></tr>`)}
      </tbody></table></div>` : html`<div className="empty-state"><${Icon} name="file" size=${28}/><h3>No documents for this event yet</h3><p className="mute">Add schedules, run sheets, maps, or anything else staff need. You choose who can view each one.</p><button className="btn" onClick=${() => setEd({ doc: null })}><${Icon} name="plus"/>Add document</button></div>`}
      ${editor && html`<${DocumentEditor} key=${editor.doc ? editor.doc.id : 'new'} doc=${editor.doc} S=${S} A=${A} onClose=${close}/>`}
    </div>`;
  }

  // Staff and contractors: documents for them in the current event.
  function DocumentList({ S, A, me }) {
    const [msg, setMsg] = useState('');
    // Connected snapshots already hold only this person's documents (no "who" list); the demo filters here.
    const list = (S.documents || []).filter(d => d.ev === current.id && (d.all || !d.who || d.who.includes(me)));
    return html`<div className="card documents-card"><b>Documents</b>
      ${list.length ? html`<ul className="rows">${list.map(d => html`<li key=${d.id}><div><b>${d.name}</b> <span className="mute">${kindText(d.type)} · ${sizeText(d.size)}</span></div>
        <div className="acts">${viewable(d.type) && html`<button className="btn ghost" onClick=${async () => setMsg(await openDocument(A, d))}><${Icon} name="eye"/>Open</button>`}<button className="btn ghost" onClick=${async () => setMsg(await downloadDocument(A, d))}><${Icon} name="download"/>Download</button></div></li>`)}</ul>`
        : html`<p className="mute">No documents have been shared with you for this event.</p>`}
      ${msg && html`<p className="connection-error" role="alert">${msg}</p>`}
    </div>`;
  }

  return { DocumentsAdmin, DocumentList };
}
