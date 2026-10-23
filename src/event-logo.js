// Event images: the logo (shown next to module headings) and the welcome splash (shown after signing in).
// Both are resized in the browser before upload and kept in the private 'event-logos' bucket.

export const LOGO_SIDE = 400; // longest side in pixels; sharp at the heading size on high-density screens
export const SPLASH_SIDE = 1600; // full-screen splash, sharp on phones and laptops
export const IMAGE_MAX = 2097152; // 2 MB; the event-logos bucket enforces the same limit
export const LOGO_MAX = IMAGE_MAX;

const decode = f => new Promise(done => {
  const u = URL.createObjectURL(f), i = new Image();
  i.onload = () => { URL.revokeObjectURL(u); done(i); };
  i.onerror = () => { URL.revokeObjectURL(u); done(null); };
  i.src = u;
});
const encode = (c, type, q) => new Promise(done => c.toBlob(done, type, q));

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

// Any image the browser can read (PNG, JPG, WebP, GIF, SVG...) is resized to at most `side` pixels on its longest
// side and re-encoded as the first of `types` that fits in 2 MB. Returns { data, type } or an error message string.
async function prepImage(f, { side, crop, types, white = false, q = 0.88, label }) {
  if (!f || !/^image\//.test(f.type || '') && !/\.(png|jpe?g|webp|gif|svg|heic|heif)$/i.test(f.name || '')) return 'Choose an image file (PNG, JPG, WebP or SVG).';
  if (f.size > 26214400) return 'That image is over 25 MB. Choose a smaller file.';
  const img = await decode(f);
  const w0 = img && img.naturalWidth, h0 = img && img.naturalHeight;
  if (!w0 || !h0) return 'This image could not be read on this device. Try a PNG or JPG version.';
  const box = crop ? trim(img, w0, h0) : { x: 0, y: 0, w: w0, h: h0 };
  const s = Math.min(1, side / Math.max(box.w, box.h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.w * s)); c.height = Math.max(1, Math.round(box.h * s));
  const g = c.getContext('2d'); if (!g) return 'This image could not be resized on this device.';
  // JPEG has no transparency, so the splash is laid on white (the splash screen's background).
  if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.imageSmoothingQuality = 'high'; g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  for (const type of types) {
    const b = await encode(c, type, q);
    if (b && b.type === type && b.size <= IMAGE_MAX) return { data: new Uint8Array(await b.arrayBuffer()), type };
  }
  return `This ${label} is still over 2 MB after resizing. Try a simpler version of the image.`;
}

// Logo: empty margins trimmed, at most 400 px, PNG (keeps transparency) or WebP.
export const prepLogo = f => prepImage(f, { side: LOGO_SIDE, crop: true, types: ['image/png', 'image/webp'], label: 'logo' });
// Splash: kept as designed (no trimming), at most 1600 px, WebP or JPEG.
export const prepSplash = f => prepImage(f, { side: SPLASH_SIDE, crop: false, white: true, types: ['image/webp', 'image/jpeg'], label: 'splash image' });

// Shared loader: object URLs by storage path, so each image downloads once per visit.
export function createImageUrls(load) {
  const urls = {};
  return async (ev, kind) => {
    const key = ev && ev[kind];
    if (!key) return null;
    if (!urls[key]) {
      const d = await load(ev, kind);
      if (!d || !d.data) return null;
      urls[key] = URL.createObjectURL(new Blob([d.data], { type: d.type }));
    }
    return urls[key];
  };
}

// <EventLogo ev=${event}/> (or kind="splash" for a thumbnail of the splash): shows the image, or nothing.
export function createEventLogo({ React, html, url }) {
  const { useState, useEffect } = React;
  return function EventLogo({ ev, kind = 'logo', className = 'event-logo' }) {
    const key = ev && ev[kind];
    const [src, setSrc] = useState(null);
    useEffect(() => {
      if (!key) { setSrc(null); return; }
      let live = true;
      url(ev, kind).then(u => { if (live) setSrc(u); }).catch(() => {});
      return () => { live = false; };
    }, [key]);
    return src ? html`<img className=${className} src=${src} alt=${ev.name + (kind === 'splash' ? ' welcome splash' : ' logo')}/>` : null;
  };
}
