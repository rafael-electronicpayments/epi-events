// App branding from App settings: name, Home Screen name, tagline, icon. Read before sign-in (public) and from
// every snapshot; components re-render through useBrand(). Also keeps the browser tab title, the iPhone
// Home Screen title/icon, and the web app manifest in step.

export const BRAND_DEFAULTS = { name: 'Impact Event Ops', short: 'Event Ops', tagline: '', icon: null, bg: '#ffffff', v: 0 };
const BUILT_IN = { 180: '/icons/apple-touch-icon.png', 192: '/icons/icon-192.png', 512: '/icons/icon-512.png', maskable: '/icons/maskable-512.png' };
const FILES = { 180: '180', 192: '192', 512: '512', maskable: 'maskable-512' };
let brand = { ...BRAND_DEFAULTS }, base = '';
const listeners = new Set();

export const getBrand = () => brand;
// Supabase project URL, for public icon addresses.
export const setBrandBase = url => { base = String(url || '').replace(/\/$/, ''); };

export function iconSrc(b, size = 192) {
  const k = FILES[size] ? String(size) : '192';
  if (b.iconData && b.iconData[k]) return b.iconData[k]; // demo: icons kept in this browser only
  if (!b.icon || !base) return BUILT_IN[k];
  return base + '/storage/v1/object/public/app-icons/' + b.icon + '/' + FILES[k] + '.png' + (b.v ? '?v=' + b.v : '');
}

function apply() {
  if (typeof document === 'undefined') return;
  document.title = brand.name;
  const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (meta) meta.setAttribute('content', brand.short || brand.name);
  const touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch) touch.setAttribute('href', iconSrc(brand, 180));
}

export function setBrand(next) {
  if (!next || typeof next !== 'object') return;
  const merged = { ...brand, ...next };
  if (JSON.stringify(merged) === JSON.stringify(brand)) return;
  brand = merged; apply();
  listeners.forEach(f => f(brand));
}

export function useBrand(React) {
  const [b, set] = React.useState(brand);
  React.useEffect(() => { listeners.add(set); set(brand); return () => { listeners.delete(set); }; }, []);
  return b;
}

// Point the page at the live manifest (current name and icon) once the site's /api/manifest answers.
export async function useLiveManifest() {
  try {
    const response = await fetch('/api/manifest', { cache: 'no-store' });
    if (!response.ok || !/json/.test(response.headers.get('content-type') || '')) return;
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/api/manifest');
  } catch { /* keep the built-in manifest */ }
}

// Icon files for phones from any image: square, centered on the background color with safe padding
// (more for Android's "maskable" icon, which may be cut to a circle). Returns { '180': Blob, ... } or a message.
export async function makeIcons(file, bg = '#ffffff') {
  if (!file || !/^image\//.test(file.type || '') && !/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '')) return 'Choose an image file (PNG, JPG, WebP, or SVG).';
  if (file.size > 26214400) return 'That image is over 25 MB. Choose a smaller file.';
  const img = await new Promise(done => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); done(i); }; i.onerror = () => { URL.revokeObjectURL(u); done(null); }; i.src = u; });
  if (!img || !img.naturalWidth || !img.naturalHeight) return 'This image could not be read on this device. Try a PNG or JPG version.';
  const out = {};
  for (const [k, n, pad] of [['180', 180, 0.12], ['192', 192, 0.12], ['512', 512, 0.12], ['maskable', 512, 0.22]]) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'); if (!g) return 'This image could not be resized on this device.';
    g.fillStyle = bg; g.fillRect(0, 0, n, n); g.imageSmoothingQuality = 'high';
    const box = n * (1 - 2 * pad), s = Math.min(box / img.naturalWidth, box / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
    g.drawImage(img, (n - w) / 2, (n - h) / 2, w, h);
    const blob = await new Promise(done => c.toBlob(done, 'image/png'));
    if (!blob) return 'This image could not be resized on this device.';
    out[k] = blob;
  }
  return out;
}
export const ICON_FILES = FILES;
