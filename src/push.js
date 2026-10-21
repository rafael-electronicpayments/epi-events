import React from 'react';
import htm from 'htm';
import { Icon, Modal } from './ui.js';

// Push notifications on this device: install guidance (iPhone/iPad), permission, subscription, and the
// "Delivery limits" explanation shared by staff and admins. Sending happens on the server (api/push-dispatch.js).
const html = htm.bind(React.createElement);
const { useState, useEffect } = React;

export function pushEnvironment(nav = navigator, win = window) {
  const ua = nav.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true;
  const supported = 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win;
  return { ios, standalone, supported };
}

export function deviceLabel(nav = navigator, win = window) {
  const ua = nav.userAgent || '', env = pushEnvironment(nav, win);
  const os = /iPhone/.test(ua) ? 'iPhone' : env.ios ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return os + ' · ' + browser + (env.standalone ? ' (Home Screen app)' : '');
}

export function keyBytes(base64url) {
  const padded = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
const sameKey = (buffer, key) => {
  if (!buffer) return false;
  const a = new Uint8Array(buffer), b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

// The service worker asks an open app to show an assignment when a notification is tapped.
export function onOpenAssignment(callback) {
  const read = () => {
    const id = Number(new URLSearchParams(window.location.search).get('asg'));
    if (!id) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    callback(id);
  };
  const message = e => {
    if (e.data?.type !== 'open') return;
    const url = new URL(e.data.url, window.location.origin);
    window.history.replaceState(null, '', url.pathname + url.search);
    read();
  };
  read();
  navigator.serviceWorker?.addEventListener('message', message);
  return () => navigator.serviceWorker?.removeEventListener('message', message);
}

export const LIMITS = [
  ['iPhone and iPad', 'Need iOS or iPadOS 16.4 or later, and the app must be added to the Home Screen and opened from there. Opened in Safari, it can\'t receive notifications.'],
  ['App removed from the Home Screen', 'That device stops receiving notifications. Add it again and turn notifications back on.'],
  ['Permission denied', 'The phone won\'t ask again. Turn it back on in Settings: iPhone, Settings › Notifications › Event Ops; Android, the browser\'s site settings › Notifications.'],
  ['Focus, Do Not Disturb, and summaries', 'Notifications can arrive silently or be held until later.'],
  ['Low Power Mode and battery saver', 'iPhone Low Power Mode and Android battery optimization or data saver can delay delivery.'],
  ['Phone off or offline', 'The push service holds a notification for a limited time (reminders 30 minutes, others 12 hours), then drops it.'],
  ['Browsers', 'Chrome, Edge, and Firefox on Android and computers; Safari on iPhone/iPad from the Home Screen; Safari on Mac (macOS 13 or later). Some in-app browsers, such as ones opened from email or social apps, can\'t receive them.'],
  ['Timing', 'Reminders go out 30 minutes before each activity in the event\'s time zone and can arrive up to about a minute late.'],
  ['Buttons on the notification', 'Notifications don\'t have an Acknowledge button. Tap one to open the assignment, then acknowledge it there.']
];

export function DeliveryLimits({ onClose }) {
  return html`<${Modal} title="When notifications can be blocked or delayed" onClose=${onClose}>
    <dl className="delivery-limits">${LIMITS.map(([term, text]) => html`<div key=${term}><dt>${term}</dt><dd>${text}</dd></div>`)}</dl>
    <p className="mute">Notifications add to the in-app notices; anything important still appears in the app.</p>
    <div className="dialog-actions"><button type="button" className="btn" onClick=${onClose}>Close</button></div><//>`;
}

// Staff and contractor setting for this device.
export function PushCard({ push }) {
  const env = pushEnvironment();
  const [state, setState] = useState(env.supported ? 'checking' : 'unsupported');
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), [limits, setLimits] = useState(false);
  const { repo, refresh, devices } = push;
  useEffect(() => {
    if (!env.supported) return;
    let live = true;
    (async () => {
      try {
        if (Notification.permission === 'denied') { if (live) setState('blocked'); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === 'granted' && sameKey(sub.options?.applicationServerKey, repo.pushKey)) {
          // Keep the server's copy current (it may have been removed after a failed delivery).
          await repo.pushRegister(sub.toJSON(), deviceLabel()).catch(() => {});
          if (live) setState('on');
        } else if (live) setState('off');
      } catch { if (live) setState('off'); }
    })();
    return () => { live = false; };
  }, []);
  const enable = async () => {
    setProblem(''); setBusy(true);
    try {
      // Apple requires the permission request to come straight from the tap.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options?.applicationServerKey, repo.pushKey)) { await sub.unsubscribe(); sub = null; }
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(repo.pushKey) });
      await repo.pushRegister(sub.toJSON(), deviceLabel());
      setState('on'); refresh?.();
    } catch (e) { setProblem(e?.message || 'Could not turn on notifications. Try again.'); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setProblem(''); setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await repo.pushUnregister(sub.endpoint); await sub.unsubscribe(); }
      setState('off'); refresh?.();
    } catch (e) { setProblem(e?.message || 'Could not turn off notifications. Try again.'); }
    finally { setBusy(false); }
  };
  const others = Math.max(0, devices - (state === 'on' ? 1 : 0));
  const more = html`<button type="button" className="link-button" onClick=${() => setLimits(true)}>When notifications can be blocked or delayed</button>`;
  let body;
  if (env.ios && !env.standalone) body = html`<b>Get notifications on this ${/iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : 'iPad'}</b>
    <p className="mute">Add Event Ops to your Home Screen first. Notifications only work from there.</p>
    <ol className="push-steps"><li>Tap <b>Share</b> <span className="mute">(the square with an arrow)</span> in Safari.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
    <li>Open <b>Event Ops</b> from your Home Screen and sign in again.</li><li>Tap <b>Turn on notifications</b> there.</li></ol>`;
  else if (state === 'unsupported') body = html`<b>Notifications aren't available in this browser</b>
    <p className="mute">Use Chrome, Edge, Firefox, or Safari. If you opened this from an email or social app, open it in your regular browser instead.</p>`;
  else if (state === 'blocked') body = html`<b>Notifications are blocked on this device</b>
    <p className="mute">Turn them on in your phone's settings: iPhone, Settings › Notifications › Event Ops; Android, tap the lock or settings icon next to the address, then Notifications. Then come back here.</p>`;
  else if (state === 'on') body = html`<b><${Icon} name="bell"/> Notifications are on for this device</b>
    <p className="mute">You'll be notified of new and changed assignments and reminded 30 minutes before each one.${others ? ` Also on ${others} other device${others === 1 ? '' : 's'}.` : ''}</p>
    <div className="acts"><button type="button" className="btn ghost" disabled=${busy} onClick=${disable}>Turn off on this device</button></div>`;
  else if (state === 'checking') body = html`<b>Notifications</b><p className="mute" role="status">Checking this device...</p>`;
  else body = html`<b>Turn on notifications</b>
    <p className="mute">Get new and changed assignments right away, plus a reminder 30 minutes before each one, even when the app is closed.${devices ? ` Already on for ${devices} other device${devices === 1 ? '' : 's'}.` : ''}</p>
    <div className="acts"><button type="button" className="btn" disabled=${busy} onClick=${enable}><${Icon} name="bell"/>${busy ? 'Turning on...' : 'Turn on notifications'}</button></div>`;
  return html`<div className=${'card push-card' + (state === 'on' ? ' on' : '')}>${body}
    ${problem && html`<p className="connection-error" role="alert">${problem}</p>`}<p className="push-more">${more}</p>
    ${limits && html`<${DeliveryLimits} onClose=${() => setLimits(false)}/>`}</div>`;
}
