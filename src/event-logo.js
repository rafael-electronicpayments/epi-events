// Event logos: resized in the browser before upload and shown next to module headings.

export const LOGO_SIDE = 400; // longest side in pixels; sharp at the heading size on high-density screens
export const LOGO_MAX = 2097152; // 2 MB; the event-logos bucket enforces the same limit

const decode = f => new Promise(done => {
  const u = URL.createObjectURL(f), i = new Image();
  i.onload = () => { URL.revokeObjectURL(u); done(i); };
  i.onerror = () => { URL.revokeObjectURL(u); done(null); };
  i.src = u;
});
const encode = (c, type) => new Promise(done => c.toBlob(done, type));

// Finds the logo inside empty margins: transparent pixels, or white ones when the corners are white.
// Returns the source rectangle to keep (the whole image if there is nothing to trim).
function trim(img, w0, h0) {
  const all = { x: 0, y: 0, w: w0, h: h0 };
  try {
    const k = Math.min(1, 1200 / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const white = i => d[i + 3] > 240 && d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245;
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
    const whiteBg = corners.every(white);
    let x1 = w, y1 = h, x2 = -1, y2 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 16 || (whiteBg && white(i))) continue;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
    }
    if (x2 < 0) return all;
    const pad = 1;
    x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(w - 1, x2 + pad); y2 = Math.min(h - 1, y2 + pad);
    return { x: x1 / k, y: y1 / k, w: (x2 - x1 + 1) / k, h: (y2 - y1 + 1) / k };
  } catch (e) { return all; } // e.g. an SVG the browser won't let us read back
}

// Any image the browser can read (PNG, JPG, WebP, GIF, SVG...) becomes a PNG at most LOGO_SIDE pixels on its
// longest side, keeping transparency. Returns { data, type } or an error message string.
export async function prepLogo(f) {
  if (!f || !/^image\//.test(f.type || '') && !/\.(png|jpe?g|webp|gif|svg|heic|heif)$/i.test(f.name || '')) return 'Choose an image file (PNG, JPG, WebP or SVG).';
  if (f.size > 26214400) return 'That image is over 25 MB. Choose a smaller file.';
  const img = await decode(f);
  const w0 = img && img.naturalWidth, h0 = img && img.naturalHeight;
  if (!w0 || !h0) return 'This image could not be read on this device. Try a PNG or JPG version of the logo.';
  const box = trim(img, w0, h0);
  const s = Math.min(1, LOGO_SIDE / Math.max(box.w, box.h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.w * s)); c.height = Math.max(1, Math.round(box.h * s));
  const g = c.getContext('2d'); if (!g) return 'This image could not be resized on this device.';
  g.imageSmoothingQuality = 'high'; g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  for (const type of ['image/png', 'image/webp']) {
    const b = await encode(c, type);
    if (b && b.type === type && b.size <= LOGO_MAX) return { data: new Uint8Array(await b.arrayBuffer()), type };
  }
  return 'This logo is still over 2 MB after resizing. Try a simpler version of the image.';
}

// <EventLogo ev=${event}/>: shows the event's logo, or nothing. load(ev) returns { data, type }.
export function createEventLogo({ React, html, load }) {
  const { useState, useEffect } = React;
  const urls = {};
  return function EventLogo({ ev, className = 'event-logo' }) {
    const key = ev && ev.logo;
    const [url, setUrl] = useState(key ? urls[key] || null : null);
    useEffect(() => {
      if (!key) { setUrl(null); return; }
      if (urls[key]) { setUrl(urls[key]); return; }
      let live = true;
      Promise.resolve(load(ev)).then(d => {
        if (!d || !d.data) return;
        urls[key] = URL.createObjectURL(new Blob([d.data], { type: d.type }));
        if (live) setUrl(urls[key]);
      }).catch(() => {});
      return () => { live = false; };
    }, [key]);
    return url ? html`<img className=${className} src=${url} alt=${ev.name + ' logo'}/>` : null;
  };
}
