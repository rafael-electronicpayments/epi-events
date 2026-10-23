import React from 'react';
import htm from 'htm';
import { Icon, IconButton } from './ui.js';

const html = htm.bind(React.createElement);
export function AuthScreen({ repository, recovery = false, onRecovered, onSignedIn, connectionError = '' }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  const [forgot, setForgot] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const submit = async event => {
    event.preventDefault(); setError(''); setMessage('');
    if (recovery && password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (recovery) {
        await repository.updatePassword(password); setPassword(''); setConfirm(''); onRecovered();
      } else if (forgot) {
        await repository.resetPassword(email.trim());
        setMessage('If this account can receive email, a password reset link has been sent.');
      } else {
        await repository.signIn(email.trim(), password); setPassword(''); if (onSignedIn) onSignedIn();
      }
    } catch {
      setError(recovery ? 'Could not update your password. Try a new reset link.' : forgot ? 'Could not request a reset link. Try again.' : 'Unable to sign in. Check your email and password.');
    } finally { setBusy(false); }
  };
  return html`<main className="auth-screen"><section className="auth-panel" aria-labelledby="auth-title">
    <div className="auth-brand"><span className="brand-mark">I</span><h1>Impact Event Ops</h1>${repository.testLoginsEnabled && html`<span className="pill">Staging</span>`}</div>
    <h2 id="auth-title">${recovery ? 'Set new password' : forgot ? 'Reset password' : 'Sign in'}</h2>
    <form onSubmit=${submit}>
      ${!recovery && html`<label>Email address<input type="email" autoComplete="username" required value=${email} disabled=${busy} onChange=${e => setEmail(e.target.value)}/></label>`}
      ${(!forgot || recovery) && html`<label>${recovery ? 'New password' : 'Password'}<div className="password-control"><input type=${visible ? 'text' : 'password'} autoComplete=${recovery ? 'new-password' : 'current-password'} required minLength=${recovery ? 12 : undefined} value=${password} disabled=${busy} onChange=${e => setPassword(e.target.value)}/><${IconButton} name=${visible ? 'eye-off' : 'eye'} label=${visible ? 'Hide password' : 'Show password'} onClick=${() => setVisible(v => !v)}/></div></label>`}
      ${recovery && html`<label>Confirm password<input type="password" autoComplete="new-password" required minLength="12" value=${confirm} disabled=${busy} onChange=${e => setConfirm(e.target.value)}/></label>`}
      ${(error || connectionError) && html`<p className="connection-error" role="alert">${error || connectionError}</p>`}
      ${message && html`<p className="auth-message" role="status">${message}</p>`}
      <button className="btn auth-submit" disabled=${busy}>${busy ? 'Please wait...' : recovery ? 'Save password' : forgot ? 'Send reset link' : 'Sign in'}<${Icon} name="right"/></button>
    </form>
    ${!recovery && html`<button type="button" className="text-button" disabled=${busy} onClick=${() => { setForgot(v => !v); setError(''); setMessage(''); setPassword(''); }}>${forgot ? 'Back to sign in' : 'Forgot password?'}</button>`}
  </section></main>`;
}
