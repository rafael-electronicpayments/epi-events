// People › Login (production): admins create a person's sign-in login and get a temporary password once to hand over.
// The person chooses their own password at first sign-in. Logins made elsewhere are shown but never changed.
import React from 'react';
import htm from 'htm';
import { Icon, IconButton, Modal } from './ui.js';

const html = htm.bind(React.createElement);
const when = t => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const site = () => window.location.origin.replace(/^https?:\/\//, '');
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function Secret({ value, label = 'Temporary password' }) {
  const [shown, setShown] = React.useState(true), [copied, setCopied] = React.useState(false);
  return html`<label>${label}<div className="password-control"><input aria-label=${label} type=${shown ? 'text' : 'password'} autoComplete="off" readOnly value=${value}/>
    <${IconButton} name=${shown ? 'eye-off' : 'eye'} label=${shown ? 'Hide password' : 'Show password'} onClick=${() => setShown(v => !v)}/>
    <${IconButton} name="copy" label="Copy password" onClick=${async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); } }}/></div>
    ${copied && html`<span className="mute" role="status">Copied</span>`}</label>`;
}

const statusText = s => s.status === 'managed' ? (s.lastSignIn ? 'Last signed in ' + when(s.lastSignIn) + (s.mustChange ? ' · hasn\'t chosen their own password yet' : '') : 'Not signed in yet')
  : s.status === 'existing' ? 'Existing login made outside the app' + (s.lastSignIn ? ' · last signed in ' + when(s.lastSignIn) : '') : '';

export function LoginPanel({ personId, name, api, dirty }) {
  const [s, setS] = React.useState(null), [busy, setBusy] = React.useState(true), [err, setErr] = React.useState(''), [pw, setPw] = React.useState(''), [confirm, setConfirm] = React.useState(false);
  const load = () => api.call('status', { personId }).then(r => setS(r.people[0] || null));
  React.useEffect(() => { let on = true; load().catch(e => on && setErr(e.message)).finally(() => on && setBusy(false)); return () => { on = false; }; }, [personId]);
  const run = async action => { setBusy(true); setErr(''); setConfirm(false);
    try { const r = await api.call(action, { personId }), x = r.results[0];
      if (x.password) setPw(x.password); else setErr(x.reason || 'Could not create the login.');
      await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return html`<section className="test-login-panel login-panel" aria-label="Sign-in login"><h3><${Icon} name="key"/>Sign-in login</h3>
    ${busy && !s && html`<p className="mute" role="status">Checking login…</p>`}
    ${err && html`<p className="connection-error" role="alert">${err}</p>`}
    ${pw && html`<${Secret} value=${pw}/><p className="login-note">Give this to ${name || 'them'}. They sign in at <b>${site()}</b> with their email and this password, then choose their own. It won't be shown again.</p>`}
    ${s && !pw && html`<p className="mute">${s.status === 'none' ? 'No login yet.' : s.status === 'no-email' ? 'Add an email to create a login.' : s.status === 'type-mismatch' ? 'Save the person first, then create the login.' : statusText(s)}</p>`}
    ${dirty && html`<p className="mute" role="status">Save the email or type change first.</p>`}
    ${s?.status === 'none' && !pw && html`<div className="acts"><button type="button" className="btn ghost" disabled=${busy || dirty} onClick=${() => run('create')}><${Icon} name="key"/>${busy ? 'Creating…' : 'Create login'}</button></div>`}
    ${s?.status === 'managed' && html`<div className="acts">${confirm ? html`<button type="button" className="btn" disabled=${busy || dirty} onClick=${() => run('reset')}>Confirm: new temporary password</button><button type="button" className="btn ghost" onClick=${() => setConfirm(false)}>Cancel</button>`
      : html`<button type="button" className="btn ghost" disabled=${busy || dirty} onClick=${() => { setPw(''); setConfirm(true); }}><${Icon} name="key"/>Reset password</button>`}</div>
      ${confirm && html`<p className="mute">Their current password stops working, and they choose a new one after signing in with the temporary password.</p>`}`}
    ${s?.status === 'existing' && html`<p className="mute">Change this login's password in Supabase (Authentication › Users).</p>`}
  </section>`;
}

// People toolbar: create logins for everyone (or chosen people) without one; the passwords are shown once.
export function BulkLogins({ api, people }) {
  const [open, setOpen] = React.useState(false);
  return html`<div className="test-login-toolbar"><button type="button" className="btn ghost" onClick=${() => setOpen(true)}><${Icon} name="key"/>Create logins</button>
    ${open && html`<${BulkDialog} api=${api} people=${people} onClose=${() => setOpen(false)}/>`}</div>`;
}

function BulkDialog({ api, people, onClose }) {
  const [list, setList] = React.useState(null), [pick, setPick] = React.useState(new Set()), [busy, setBusy] = React.useState(false), [err, setErr] = React.useState(''), [done, setDone] = React.useState(null), [progress, setProgress] = React.useState('');
  const [sure, setSure] = React.useState(false), [copied, setCopied] = React.useState(false);
  const nameOf = id => people.find(p => p.id === id)?.name || 'Person ' + id;
  React.useEffect(() => { api.call('status', {}).then(r => { const l = r.people.map(x => ({ ...x, name: nameOf(x.personId) })).sort((a, b) => a.name.localeCompare(b.name)); setList(l); setPick(new Set(l.filter(x => x.status === 'none').map(x => x.personId))); }).catch(e => setErr(e.message)); }, []);
  const count = k => (list || []).filter(x => x.status === k).length;
  const ready = (list || []).filter(x => x.status === 'none');
  const toggle = id => setPick(v => { const n = new Set(v); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const create = async () => { setBusy(true); setErr(''); const ids = [...pick], out = [];
    try { for (let i = 0; i < ids.length; i += 10) { setProgress('Creating ' + Math.min(i + 10, ids.length) + ' of ' + ids.length + '…'); out.push(...(await api.call('create', { personIds: ids.slice(i, i + 10) })).results); } }
    catch (e) { setErr(e.message + (out.length ? ' Some logins were created; they are listed below.' : '')); }
    setProgress(''); setBusy(false); setDone(out.sort((a, b) => a.name.localeCompare(b.name))); api.refresh && api.refresh(); };
  const made = (done || []).filter(r => r.password);
  const text = made.map(r => [r.name, r.email, r.password].join('\t')).join('\n');
  const print = () => { const w = window.open('', '_blank'); if (!w) { setErr('Your browser blocked the window. Allow pop-ups for this site and try again.'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Sign-in logins</title><style>body{font:12px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #bbb;padding:6px;text-align:left}code{font-size:13px}</style><h1>Sign-in logins</h1><p>Sign in at ${esc(site())} with your email and this temporary password, then choose your own. Keep this page private and destroy it after handing out the passwords.</p><table><tr><th>Name</th><th>Email</th><th>Temporary password</th></tr>${made.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td><code>${esc(r.password)}</code></td></tr>`).join('')}</table><script>print()</script>`);
    w.document.close(); };
  const close = () => { if (made.length && !sure) { setSure(true); return; } onClose(); };
  return html`<${Modal} title="Create logins" onClose=${busy ? () => {} : close}><div className="bulk-logins">
    ${!list && !err && html`<p className="mute" role="status">Checking logins…</p>`}
    ${err && html`<p className="connection-error" role="alert">${err}</p>`}
    ${list && !done && html`<p className="mute">${count('none')} without a login · ${count('managed')} created here · ${count('existing')} existing (made outside the app, left alone) · ${count('no-email') + count('type-mismatch')} need an email or type fixed in People.</p>
      ${ready.length ? html`<fieldset className="break-people"><legend>Create logins for <span className="mute">${pick.size} selected</span></legend>
        <div className="break-people-tools"><button type="button" className="btn ghost" onClick=${() => setPick(new Set(ready.map(x => x.personId)))}>Select all</button>${pick.size > 0 && html`<button type="button" className="btn ghost" onClick=${() => setPick(new Set())}>Clear</button>`}</div>
        <div className="break-people-list">${ready.map(x => html`<label key=${x.personId} className="chk"><input type="checkbox" checked=${pick.has(x.personId)} onChange=${() => toggle(x.personId)}/>${x.name}<span className="mute">${x.email}</span></label>`)}</div></fieldset>`
        : html`<p>Everyone with an email already has a login.</p>`}
      <p className="mute">No email is sent. You'll see each temporary password once, to copy or print and hand out. People choose their own password the first time they sign in at ${site()}.</p>`}
    ${done && html`<p className="mute">${made.length} login${made.length === 1 ? '' : 's'} created. These passwords are shown only now: copy or print them before closing.</p>
      <div className="data-surface"><table className="data-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Temporary password</th></tr></thead><tbody>
        ${done.map(r => html`<tr key=${r.personId}><td><b>${r.name}</b>${r.reason && html`<span className="cell-secondary warn-text">${r.reason === 'managed' || r.reason === 'existing' ? 'Already has a login' : r.reason}</span>`}</td><td>${r.email || ''}</td><td>${r.password ? html`<code className="login-code">${r.password}</code>` : html`<span className="mute">–</span>`}</td></tr>`)}
      </tbody></table></div>`}
    ${progress && html`<p className="mute" role="status">${progress}</p>`}
    ${sure && html`<p className="connection-error" role="alert">The passwords won't be shown again. Close anyway? (Press Close again.)</p>`}
    <div className="dialog-actions">
      ${done ? html`${made.length > 0 && html`<button type="button" className="btn ghost" onClick=${async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setErr('Could not copy.'); } }}><${Icon} name="copy"/>${copied ? 'Copied' : 'Copy all'}</button><button type="button" className="btn ghost" onClick=${print}><${Icon} name="print"/>Print</button>`}<button type="button" className="btn" onClick=${close}>Close</button>`
        : html`<button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy || !pick.size} onClick=${create}><${Icon} name="key"/>${busy ? 'Creating…' : 'Create ' + pick.size + ' login' + (pick.size === 1 ? '' : 's')}</button>`}</div>
  </div><//>`;
}

// First sign-in with a temporary password: the person must choose their own before using the app.
export function SetOwnPassword({ email, onSave, onSignOut }) {
  const [a, setA] = React.useState(''), [b, setB] = React.useState(''), [busy, setBusy] = React.useState(false), [err, setErr] = React.useState('');
  const submit = async e => { e.preventDefault(); setErr('');
    if (a.length < 12) { setErr('Use at least 12 characters.'); return; }
    if (a !== b) { setErr('The two passwords don\'t match.'); return; }
    setBusy(true); try { await onSave(a); } catch (x) { setErr(x.message || 'Could not save your password. Sign out and sign in again, then try once more.'); } finally { setBusy(false); } };
  return html`<main className="auth wrap m"><div className="auth-panel"><h1>Choose your password</h1>
    <p className="mute">You signed in as <b>${email}</b> with a temporary password. Choose your own to continue; you'll use it from now on.</p>
    <form className="form" onSubmit=${submit}>
      <label>New password<input type="password" autoComplete="new-password" required value=${a} onChange=${e => setA(e.target.value)}/><span className="mute field-hint">At least 12 characters.</span></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" required value=${b} onChange=${e => setB(e.target.value)}/></label>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      <button className="btn" disabled=${busy}>${busy ? 'Saving…' : 'Save and continue'}</button>
      <button type="button" className="btn ghost" disabled=${busy} onClick=${onSignOut}>Sign out</button></form></div></main>`;
}
