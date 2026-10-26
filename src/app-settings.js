// Manage > App settings (admins): app name, Home Screen name, tagline, and phone icon. Saved for everyone at once.
import { useBrand, iconSrc, makeIcons } from './branding.js';

export function createAppSettings({ React, html, Icon }) {
  const { useState, useEffect } = React;
  const field = (text, input, hint) => html`<label>${text}${input}${hint && html`<span className="mute field-hint">${hint}</span>`}</label>`;
  return function AppSettings({ A }) {
    const b = useBrand(React);
    const [d, setD] = useState({ name: b.name, short: b.short, tagline: b.tagline, bg: b.bg || '#ffffff' });
    const [icon, setIcon] = useState(null), [file, setFile] = useState(null), [reset, setReset] = useState(false);
    const [busy, setBusy] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState('');
    useEffect(() => { setD({ name: b.name, short: b.short, tagline: b.tagline, bg: b.bg || '#ffffff' }); }, [b.v, b.name, b.short, b.tagline, b.bg]);
    const set = k => e => { setD(v => ({ ...v, [k]: e.target.value })); setMsg(''); };
    const build = async (f, bg) => { setBusy('Making icons…'); setErr(''); const r = await makeIcons(f, bg).catch(() => 'This image could not be read on this device.'); setBusy('');
      if (typeof r === 'string') { setErr(r); return; } setIcon(r); setReset(false); };
    const pick = e => { const f = e.target.files[0]; e.target.value = ''; if (f) { setFile(f); build(f, d.bg); } };
    useEffect(() => { if (file) build(file, d.bg); }, [d.bg]);
    const preview = icon ? URL.createObjectURL(icon['192']) : reset ? '/icons/icon-192.png' : iconSrc(b, 192);
    useEffect(() => () => { if (icon) URL.revokeObjectURL(preview); }, [preview]);
    const save = async e => {
      e.preventDefault(); setErr(''); setMsg('');
      const name = d.name.trim(), short = d.short.trim(), tagline = d.tagline.trim();
      if (!name || name.length > 40) { setErr('Enter an app name of up to 40 characters.'); return; }
      if (short.length > 12) { setErr('The Home Screen name can be up to 12 characters.'); return; }
      setBusy(icon ? 'Uploading icon…' : 'Saving…');
      const ok = await A.setBranding({ name, short, tagline, bg: d.bg }, icon, reset);
      setBusy('');
      if (ok !== false) { setIcon(null); setFile(null); setReset(false); setMsg('Saved. Everyone sees the new name right away.'); } else setErr('Could not save. Check the values and try again.');
    };
    const changed = icon || reset || d.name !== b.name || d.short !== b.short || d.tagline !== b.tagline || d.bg !== (b.bg || '#ffffff');
    return html`<form className="app-settings" onSubmit=${save}>
      <div className="card app-settings-card"><h3>Name and tagline</h3>
        <div className="editor-fields">
          <label className="wide-field">App name<input required maxLength="40" value=${d.name} onChange=${set('name')}/><span className="mute field-hint">Shown in the header, on the sign-in screen, in the browser tab, and under the welcome splash.</span></label>
          ${field('Home Screen name', html`<input maxLength="12" value=${d.short} placeholder=${d.name.trim().slice(0, 12)} onChange=${set('short')}/>`, 'Label under the phone icon, up to 12 characters. Left blank, the app name is shortened to fit.')}
          <label className="wide-field">Tagline<input maxLength="120" value=${d.tagline} placeholder="One line under the app name" onChange=${set('tagline')}/><span className="mute field-hint">Optional, one line.</span></label>
        </div></div>
      <div className="card app-settings-card"><h3>Phone icon</h3>
        <div className="icon-row"><img className="icon-preview" src=${preview} alt="App icon preview"/><img className="icon-preview round" src=${preview} alt=""/>
          <div className="icon-tools">
            <label className="btn ghost file-pick"><${Icon} name="upload"/>${icon || b.icon ? 'Replace icon' : 'Upload icon'}<input type="file" accept="image/*,.svg" disabled=${!!busy} onChange=${pick}/></label>
            ${(b.icon || icon) && !reset && html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => { setIcon(null); setFile(null); setReset(true); }}>Use the default icon</button>`}
            <label className="color-field">Background<input type="color" value=${d.bg} onChange=${set('bg')}/></label>
          </div></div>
        <p className="mute field-hint">Use a square logo, at least 512 × 512 pixels. It's centered on the background color with a margin, and every size phones need is made for you. ${icon ? 'Not saved yet.' : ''}</p>
      </div>
      <div className="card app-settings-card note"><h3>How phones pick up changes</h3>
        <ul><li><b>In the app</b> (header, sign-in screen, splash): right away, on every device.</li>
          <li><b>iPhone Home Screen</b> name and icon: only when the app is added again. Ask iPhone users to remove Event Ops from the Home Screen and add it again from Safari.</li>
          <li><b>Android</b>: Chrome updates the icon and name by itself, usually within a day or two, and may ask the person to accept the change.</li></ul></div>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}${msg && html`<p className="auth-message" role="status">${msg}</p>`}
      <div className="dialog-actions"><button type="submit" className="btn" disabled=${!!busy || !changed}>${busy || 'Save settings'}</button></div>
    </form>`;
  };
}
