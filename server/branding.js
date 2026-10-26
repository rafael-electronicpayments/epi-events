// App name, Home Screen name, and icon for phones, read from App settings (the public app_branding function).
// GET /api/manifest  -> web app manifest with the current name and icons (falls back to the built-in ones).
// GET /api/app-icon?size=180|192|512|maskable -> redirects to the current icon image.

export const DEFAULTS = { name: 'Impact Event Ops', short: 'Event Ops', tagline: '', icon: null, bg: '#ffffff' };
const BUILT_IN = { 180: '/icons/apple-touch-icon.png', 192: '/icons/icon-192.png', 512: '/icons/icon-512.png', maskable: '/icons/maskable-512.png' };
const SIZES = { 180: '180', 192: '192', 512: '512', maskable: 'maskable-512' };

export async function fetchBranding(env, fetchImpl = fetch) {
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ...DEFAULTS };
  try {
    const response = await fetchImpl(url.replace(/\/$/, '') + '/rest/v1/rpc/app_branding', {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!response.ok) return { ...DEFAULTS }; // e.g. a database without the App settings migration
    const data = await response.json();
    return data && typeof data === 'object' ? { ...DEFAULTS, ...data } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function iconUrl(env, branding, size) {
  const key = SIZES[size] ? String(size) : '192';
  if (!branding.icon || !/^[A-Za-z0-9-]{8,64}$/.test(branding.icon) || !env.VITE_SUPABASE_URL) return BUILT_IN[key];
  return env.VITE_SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/app-icons/' + branding.icon + '/' + SIZES[key] + '.png' + (branding.v ? '?v=' + branding.v : '');
}

export function manifestFor(env, branding) {
  const icon = size => iconUrl(env, branding, size);
  return {
    id: '/', name: branding.name, short_name: branding.short || branding.name.slice(0, 12),
    description: branding.tagline || 'Event schedules, assignments, and reminders for staff.',
    start_url: '/', scope: '/', display: 'standalone', background_color: branding.bg || '#ffffff', theme_color: '#0B6E6B',
    icons: [
      { src: icon(192), sizes: '192x192', type: 'image/png' },
      { src: icon(512), sizes: '512x512', type: 'image/png' },
      { src: icon('maskable'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}

export function createBrandingHandlers({ env, fetchImpl = fetch }) {
  const cache = { 'Cache-Control': 'public, max-age=300, s-maxage=300' };
  return {
    manifest: async () => Response.json(manifestFor(env, await fetchBranding(env, fetchImpl)),
      { headers: { ...cache, 'Content-Type': 'application/manifest+json' } }),
    icon: async request => {
      const size = new URL(request.url).searchParams.get('size') || '192';
      return new Response(null, { status: 302, headers: { ...cache, Location: iconUrl(env, await fetchBranding(env, fetchImpl), size) } });
    }
  };
}
