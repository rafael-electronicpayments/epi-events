// Welcome splash: the event's splash image, shown right after signing in (and as a preview in Event setup).
// It stays about 3 seconds once the image is on screen, and closes at once on a tap, click, or key press.
import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);
export const SPLASH_MS = 3000;
const LOAD_LIMIT_MS = 6000; // give up quietly if the image can't be fetched in time

// url(): resolves to an image URL (or null when there's nothing to show).
export function Splash({ url, label = 'Welcome', onClose }) {
  const [src, setSrc] = React.useState(null), [leaving, setLeaving] = React.useState(false);
  const done = React.useRef(false), timer = React.useRef(null);
  const close = React.useCallback(() => {
    if (done.current) return;
    done.current = true; clearTimeout(timer.current); setLeaving(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  React.useEffect(() => {
    let live = true;
    timer.current = setTimeout(close, LOAD_LIMIT_MS);
    Promise.resolve(url()).then(u => { if (!live) return; if (u) setSrc(u); else close(); }).catch(() => close());
    const key = e => { if (['Escape', 'Enter', ' '].includes(e.key)) close(); };
    window.addEventListener('keydown', key);
    return () => { live = false; clearTimeout(timer.current); window.removeEventListener('keydown', key); };
  }, []);
  const shown = () => { clearTimeout(timer.current); timer.current = setTimeout(close, SPLASH_MS); };
  return html`<button type="button" className=${'splash' + (leaving ? ' leaving' : '')} aria-label=${label + '. Tap to continue.'} onClick=${close}>
    ${src && html`<img src=${src} alt=${label} onLoad=${shown} onError=${close}/>`}
  </button>`;
}
