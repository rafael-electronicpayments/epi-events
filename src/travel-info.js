// Arrival and departure instructions per event (Event › Airport Shuttle): formatted text that admins write
// or paste from Word, shown to people on their phone as an Arrival card and a Departure card. Only a small set of
// formatting is kept (bold, italic, underline, highlight, lists, links); everything else is removed, both when saving
// and every time it is shown.
import { whenText, hasPickup, rideText } from './itineraries.js';

export const INFO_MAX = 20000;
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'META', 'LINK', 'SVG', 'MATH', 'NOSCRIPT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS']);
const PARA = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'PRE', 'ADDRESS', 'CENTER', 'DT', 'DD']);
const SIMPLE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', MARK: 'mark' };
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;

export function safeHref(href) {
  const h = String(href || '').trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(h) && !/[\s<>"']/.test(h) ? h : '';
}
// The formatting a Word paste carries in inline styles (spans), as tags.
function styleTags(el) {
  const st = el.style, tags = [];
  if (!st) return tags;
  if (/^(bold|bolder|[6-9]00)$/.test(st.fontWeight)) tags.push('b');
  if (st.fontStyle === 'italic') tags.push('i');
  if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) tags.push('u');
  const bg = (st.backgroundColor || st.background || '').toLowerCase().replace(/\s/g, '');
  if (bg && !/^(transparent|inherit|initial|none|white|#fff|#ffffff|rgb\(255,255,255\)|rgba\(0,0,0,0\)|windowtext)/.test(bg)) tags.push('mark');
  return tags;
}

// Returns clean HTML. With phones: true, phone numbers become tap-to-call links (for display).
export function cleanHtml(input, { phones = false } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(input || '');
  const out = document.createElement('div');
  const inside = (node, tag) => { for (let x = node; x && x !== out; x = x.parentNode) if (x.tagName === tag) return true; return false; };
  const text = (value, dst) => {
    const t = value.replace(/[ \s]+/g, m => m.includes('\n') || m.includes('\r') ? ' ' : m.replace(/ /g, ' '));
    if (!phones || inside(dst, 'A')) { dst.appendChild(document.createTextNode(t)); return; }
    let last = 0;
    for (const m of t.matchAll(PHONE)) {
      if (m.index > last) dst.appendChild(document.createTextNode(t.slice(last, m.index)));
      const a = document.createElement('a'); a.href = 'tel:' + m[0].replace(/[^\d+]/g, ''); a.textContent = m[0]; dst.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < t.length) dst.appendChild(document.createTextNode(t.slice(last)));
  };
  const walk = (src, dst) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === 3) { text(n.nodeValue, dst); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toUpperCase();
      if (DROP.has(tag) || tag.includes(':')) continue; // Word's <o:p> and friends
      if (tag === 'BR') { dst.appendChild(document.createElement('br')); continue; }
      let target = dst;
      if (PARA.has(tag) || tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD') {
        if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD') { walk(n, dst); continue; }
        if (inside(dst, 'P') || inside(dst, 'LI')) { walk(n, dst); dst.appendChild(document.createElement('br')); continue; }
        target = dst.appendChild(document.createElement('p'));
        if (/^H\d$/.test(tag)) target = target.appendChild(document.createElement('b'));
      } else if (tag === 'UL' || tag === 'OL') {
        target = dst.appendChild(document.createElement(tag.toLowerCase()));
      } else if (tag === 'LI') {
        if (!inside(dst, 'UL') && !inside(dst, 'OL')) target = dst.appendChild(document.createElement('ul'));
        target = target.appendChild(document.createElement('li'));
      } else if (tag === 'A') {
        const href = safeHref(n.getAttribute('href'));
        if (href && !inside(dst, 'A')) { target = dst.appendChild(document.createElement('a')); target.setAttribute('href', href); }
      } else if (SIMPLE[tag]) {
        if (!inside(dst, SIMPLE[tag].toUpperCase())) target = dst.appendChild(document.createElement(SIMPLE[tag]));
      }
      for (const t of styleTags(n)) if (!inside(target, t.toUpperCase())) target = target.appendChild(document.createElement(t));
      walk(n, target);
    }
  };
  walk(tpl.content, out);
  // Drop empty formatting and empty paragraphs (Word adds many), and trailing line breaks.
  for (let pass = 0; pass < 3; pass++) for (const el of [...out.querySelectorAll('b,i,u,mark,a,p,li,ul,ol')]) {
    if (!el.textContent.trim() && !el.querySelector('br')) el.remove();
    else if (el.tagName === 'P' && !el.textContent.trim()) el.remove();
  }
  for (const el of out.querySelectorAll('a')) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  for (const p of out.querySelectorAll('p,li')) while (p.lastChild && p.lastChild.nodeName === 'BR') p.lastChild.remove();
  return out.innerHTML.trim();
}
export const plainText = h => { const d = document.createElement('div'); d.innerHTML = String(h || ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

export function createTravelInfo({ React, html, Icon, events, current, demo = false }) {
  const { useState, useRef, useEffect } = React;
  const evOf = id => events.find(e => e.id === id) || {};

  // A small rich text box: the browser's editing commands, a sanitized paste, and the toolbar below.
  function RichText({ label, value, onChange, hint }) {
    const ref = useRef(null), saved = useRef(null), [link, setLink] = useState(null);
    useEffect(() => { if (ref.current) ref.current.innerHTML = cleanHtml(value); }, []);
    const changed = () => onChange(ref.current.innerHTML);
    const keep = e => e.preventDefault(); // keep the text selection when pressing a toolbar button
    const exec = (cmd, arg) => { ref.current.focus(); document.execCommand(cmd, false, arg); changed(); };
    const highlight = () => { ref.current.focus(); document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, '#fde68a'); document.execCommand('styleWithCSS', false, false); changed(); };
    const clear = () => { ref.current.focus(); document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, 'transparent'); document.execCommand('styleWithCSS', false, false); document.execCommand('removeFormat'); document.execCommand('unlink'); changed(); };
    const startLink = () => { const s = window.getSelection(); saved.current = s.rangeCount && ref.current.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; setLink({ url: '', err: '' }); };
    const addLink = () => {
      let url = link.url.trim();
      if (/^[\d\s()+.-]{7,}$/.test(url)) url = 'tel:' + url.replace(/[^\d+]/g, '');
      else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) url = 'mailto:' + url;
      else if (url && !/^[a-z]+:/i.test(url)) url = 'https://' + url;
      if (!safeHref(url)) { setLink({ ...link, err: 'Enter a web address, email, or phone number.' }); return; }
      ref.current.focus();
      const s = window.getSelection();
      if (saved.current) { s.removeAllRanges(); s.addRange(saved.current); }
      if (s.isCollapsed) document.execCommand('insertHTML', false, '<a href="' + url.replace(/"/g, '') + '">' + link.url.trim().replace(/[<>&"]/g, '') + '</a>');
      else document.execCommand('createLink', false, url);
      setLink(null); changed();
    };
    const paste = e => {
      e.preventDefault();
      const h = e.clipboardData.getData('text/html'), t = e.clipboardData.getData('text/plain');
      const insert = h ? cleanHtml(h) : t.split(/\r?\n/).map(l => l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))).join('<br>');
      document.execCommand('insertHTML', false, insert); changed();
    };
    const B = (name, title, onClick) => html`<button type="button" className="rt-btn" title=${title} aria-label=${title} onMouseDown=${keep} onClick=${onClick}><${Icon} name=${name}/></button>`;
    return html`<div className="rt-field"><b className="rt-label">${label}</b>
      <div className="rt-toolbar" role="toolbar" aria-label=${label + ' formatting'}>
        ${B('bold', 'Bold', () => exec('bold'))}${B('italic', 'Italic', () => exec('italic'))}${B('underline', 'Underline', () => exec('underline'))}${B('highlighter', 'Highlight', highlight)}
        ${B('list', 'Bulleted list', () => exec('insertUnorderedList'))}${B('list-ordered', 'Numbered list', () => exec('insertOrderedList'))}${B('link', 'Link', startLink)}${B('eraser', 'Clear formatting', clear)}</div>
      ${link && html`<div className="rt-link"><input aria-label="Link address" autoFocus placeholder="Web address, email, or phone" value=${link.url} onChange=${e => setLink({ url: e.target.value, err: '' })} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } if (e.key === 'Escape') setLink(null); }}/>
        <button type="button" className="btn" onClick=${addLink}>Add link</button><button type="button" className="btn ghost" onClick=${() => setLink(null)}>Cancel</button>${link.err && html`<p className="connection-error" role="alert">${link.err}</p>`}</div>`}
      <div ref=${ref} className="rt-box rich-text" contentEditable="true" role="textbox" aria-multiline="true" aria-label=${label} onInput=${changed} onBlur=${changed} onPaste=${paste}></div>
      ${hint && html`<span className="mute field-hint">${hint}</span>`}</div>`;
  }

  // Admin page for the current event.
  function TravelInfoAdmin({ S, A }) {
    const ev = current.id, e0 = evOf(ev), [arr, setArr] = useState(e0.arrInfo || ''), [dep, setDep] = useState(e0.depInfo || '');
    const [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [base, setBase] = useState({ arr: cleanHtml(e0.arrInfo || ''), dep: cleanHtml(e0.depInfo || '') });
    const ho = (S.hotels || []).filter(h => h.ev === ev), nIn = ho.filter(h => hasPickup(h.tIn)).length, nOut = ho.filter(h => hasPickup(h.tOut)).length;
    const a = cleanHtml(arr), d = cleanHtml(dep), dirty = a !== base.arr || d !== base.dep;
    const save = async () => {
      setErr(''); setMsg('');
      if (a.length > INFO_MAX || d.length > INFO_MAX) { setErr('The instructions are too long. Each box can hold up to 20,000 characters, including formatting.'); return; }
      setBusy(true); const r = await A.setTravelInfo(ev, { arr: plainText(a) ? a : '', dep: plainText(d) ? d : '' }); setBusy(false);
      if (r !== false) { setBase({ arr: plainText(a) ? a : '', dep: plainText(d) ? d : '' }); setMsg('Saved. People see the changes the next time their app refreshes.'); } else setErr('Could not save. Try again.');
    };
    const who = (n, way) => n + (n === 1 ? ' person has' : ' people have') + ' a car service or group shuttle ' + way + ' and will see this.';
    return html`<div className="travel-info-admin">
      <p className="mute">Instructions for ${e0.name}. Write them here or paste from Word; bold, italic, underline, highlight, lists, and links are kept. Each traveler's own pickup time is added to the top of their Airport Shuttle: Departure card automatically.</p>
      <div className="travel-info-grid">
        <${RichText} key=${'a' + ev} label="Arrivals" value=${e0.arrInfo || ''} onChange=${setArr} hint=${'Shown to people whose airport-to-hotel transfer is a car service or group shuttle. ' + who(nIn, 'from the airport')}/>
        <${RichText} key=${'d' + ev} label="Departures" value=${e0.depInfo || ''} onChange=${setDep} hint=${'Shown to people whose hotel-to-airport transfer is a car service or group shuttle. ' + who(nOut, 'to the airport')}/>
      </div>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}${msg && !dirty && html`<p className="mute" role="status">${msg}</p>`}
      <div className="dialog-actions"><button type="button" className="btn" disabled=${busy || !dirty} onClick=${save}>${busy ? 'Saving…' : dirty ? 'Save instructions' : 'Saved'}</button></div>
    </div>`;
  }

  // Staff cards (phone and web): only for the ways their transfer is a car or shuttle, and only if there's text.
  function TravelInfoCards({ S, me }) {
    const ev = current.id, e0 = evOf(ev), h = (S.hotels || []).find(x => x.ev === ev && x.e === me);
    if (!h) return null;
    const f = (S.flights || []).find(x => x.ev === ev && x.e === me);
    const arr = hasPickup(h.tIn) && plainText(e0.arrInfo) ? cleanHtml(e0.arrInfo, { phones: true }) : '';
    const dep = hasPickup(h.tOut) && plainText(e0.depInfo) ? cleanHtml(e0.depInfo, { phones: true }) : '';
    return html`${arr && html`<div className="card travel-info-card"><b><${Icon} name="plane-landing"/> Airport Shuttle: Arrival</b><div className="rich-text" dangerouslySetInnerHTML=${{ __html: arr }}></div></div>`}
      ${dep && html`<div className="card travel-info-card"><b><${Icon} name="plane-takeoff"/> Airport Shuttle: Departure</b>
        ${h.pickup && html`<p className="pickup-banner"><b>Your pickup: ${whenText(h.pickup, e0.tz)}</b> at the hotel (${rideText(h.tOut)}).${f && f.outDepart ? ' Flight ' + (f.outFlight ? f.outFlight + ' ' : '') + 'departs ' + whenText(f.outDepart, e0.tz) + '.' : ''}</p>`}
        <div className="rich-text" dangerouslySetInnerHTML=${{ __html: dep }}></div></div>`}`;
  }

  return { TravelInfoAdmin, TravelInfoCards };
}
