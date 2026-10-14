import React from 'react';
import htm from 'htm';
import { Icon, IconButton } from './ui.js';

const html = htm.bind(React.createElement);
export function BulkTestLogins({ api }) {
  const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState(''), [error, setError] = React.useState('');
  return html`<div className="test-login-toolbar"><button type="button" className="btn ghost" disabled=${busy} onClick=${async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.call('provision'); await api.refresh();
      setMessage(`${result.created} created · ${result.ready} already ready · ${result.skipped} skipped`);
      if (result.errors.length) setError(`${result.errors.length} accounts could not be created. Retry to provision the remaining accounts.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }}><${Icon} name="key"/>${busy ? 'Creating test logins...' : 'Create test logins'}</button>
  ${message && html`<span className="mute" role="status">${message}</span>`}${error && html`<p className="connection-error" role="alert">${error}</p>`}</div>`;
}

export function TestLoginPanel({ personId, api, dirty }) {
  const [data, setData] = React.useState(null), [busy, setBusy] = React.useState(true), [error, setError] = React.useState('');
  const [visible, setVisible] = React.useState(false), [copied, setCopied] = React.useState(false), [confirmReset, setConfirmReset] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    api.call('credentials', personId).then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [personId]);
  const reset = async () => {
    setBusy(true); setError(''); setCopied(false); setVisible(false); setConfirmReset(false);
    try { setData(await api.call('reset', personId)); await api.refresh(); }
    catch (e) { setData(null); setError(e.message); } finally { setBusy(false); }
  };
  return html`<section className="test-login-panel" aria-label="Staging test login"><h3><${Icon} name="key"/>Staging test login</h3>
    ${busy && html`<p className="mute" role="status">Loading test credentials...</p>`}
    ${error && html`<p className="connection-error" role="alert">${error}</p>`}
    ${data?.status === 'ready' && html`<label>Temporary password<div className="password-control"><input aria-label="Temporary password" type=${visible ? 'text' : 'password'} autoComplete="off" readOnly value=${data.password}/><${IconButton} name=${visible ? 'eye-off' : 'eye'} label=${visible ? 'Hide temporary password' : 'Show temporary password'} onClick=${() => setVisible(v => !v)}/><${IconButton} name="copy" label="Copy temporary password" onClick=${async () => {
      try { await navigator.clipboard.writeText(data.password); setCopied(true); }
      catch { setError('Could not copy the password.'); }
    }}/></div></label>`}
    ${copied && html`<span className="mute" role="status">Copied</span>`}
    ${dirty && html`<p className="mute" role="status">Unsaved account changes</p>`}
    ${data?.status === 'unmanaged' ? html`<p className="mute">Existing account · password unavailable</p>` : html`<div className="acts">
      ${confirmReset ? html`<button type="button" className="btn" disabled=${busy || dirty} onClick=${reset}>Confirm password reset</button><button type="button" className="btn ghost" onClick=${() => setConfirmReset(false)}>Cancel reset</button>` : html`<button type="button" className="btn ghost" disabled=${busy || dirty} onClick=${() => data?.status === 'ready' ? setConfirmReset(true) : reset()}><${Icon} name="key"/>${data?.status === 'ready' ? 'Reset temporary password' : 'Create test login'}</button>`}
    </div>`}
  </section>`;
}
