import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrandingHandlers, fetchBranding } from '../server/branding.js';

const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const reply = body => async (url, init) => { reply.calls.push([url, init]); return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('{"message":"missing"}', { status: 404 }); };
reply.calls = [];

test('manifest uses the App settings name and uploaded icon, read with the public key only', async () => {
  const h = createBrandingHandlers({ env, fetchImpl: reply({ name: 'Impact 2027', short: 'Impact', tagline: 'Payments. People.', icon: 'abc12345-x', bg: '#0b6e6b', v: 42 }) });
  const res = await h.manifest();
  const m = await res.json();
  assert.equal(res.headers.get('content-type'), 'application/manifest+json');
  assert.deepEqual([m.name, m.short_name, m.description, m.background_color], ['Impact 2027', 'Impact', 'Payments. People.', '#0b6e6b']);
  assert.equal(m.icons[0].src, 'https://example.supabase.co/storage/v1/object/public/app-icons/abc12345-x/192.png?v=42');
  assert.equal(m.icons[2].purpose, 'maskable');
  const [url, init] = reply.calls.at(-1);
  assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/app_branding');
  assert.equal(init.headers.apikey, 'sb_publishable_test');
  assert.equal(init.headers.Authorization, undefined);
  const icon = await h.icon(new Request('https://site.test/api/app-icon?size=180'));
  assert.equal(icon.status, 302);
  assert.equal(icon.headers.get('location'), 'https://example.supabase.co/storage/v1/object/public/app-icons/abc12345-x/180.png?v=42');
});

test('falls back to the built-in name and icons when settings are missing or unreadable', async () => {
  const m = await (await createBrandingHandlers({ env, fetchImpl: reply(null) }).manifest()).json();
  assert.deepEqual([m.name, m.short_name, m.icons[0].src], ['Impact Event Ops', 'Event Ops', '/icons/icon-192.png']);
  const h = createBrandingHandlers({ env, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await h.icon(new Request('https://site.test/api/app-icon?size=512'))).headers.get('location'), '/icons/icon-512.png');
  assert.equal((await fetchBranding({}, reply({ name: 'X' }))).name, 'Impact Event Ops', 'no configuration');
  assert.equal((await h.icon(new Request('https://site.test/api/app-icon?size=../../x'))).headers.get('location'), '/icons/icon-192.png');
});
