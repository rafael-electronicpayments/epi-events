import assert from 'node:assert/strict';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), 'VITE_');
const site = new URL(process.env.EVENT_OPS_TEST_URL);
assert.equal(site.protocol, 'https:', 'Set EVENT_OPS_TEST_URL to the hosted app HTTPS URL');
const canonical = site.origin + '/';
const api = new URL(env.VITE_SUPABASE_URL);
assert.equal(api.protocol, 'https:');

// This cannot authenticate anyone: use an invalid token and never follow redirects.
const cases = [
  { name: 'Site URL fallback', requested: null, expected: canonical },
  { name: 'Hosted app redirect', requested: canonical, expected: canonical },
  { name: 'Local development redirect', requested: 'http://localhost:3000/', expected: 'http://localhost:3000/' },
  { name: 'Unapproved redirect rejection', requested: 'https://redirect-check.invalid/', expected: canonical }
];
for (const { name, requested, expected } of cases) {
  const url = new URL('/auth/v1/verify', api);
  url.searchParams.set('token', '0'.repeat(64));
  url.searchParams.set('type', 'magiclink');
  if (requested) url.searchParams.set('redirect_to', requested);
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  assert.ok([302, 303, 307].includes(response.status), `${name}: expected Auth redirect`);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin + location.pathname, expected, `${name}: check Supabase Auth URL Configuration`);
  console.log(`${name}: ${expected}`);
}
