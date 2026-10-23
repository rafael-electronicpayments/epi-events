import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushDispatchHandler, REQUIRED } from '../server/push-dispatch.js';

const SECRET = 'test-only-dispatch-secret-0000000000000000';
const env = { PUSH_DISPATCH_SECRET: SECRET, VITE_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-test-key',
  VITE_VAPID_PUBLIC_KEY: 'public-key', VAPID_PRIVATE_KEY: 'private-key', VAPID_SUBJECT: 'mailto:ops@example.test' };
const device = (id, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`) => ({ id, endpoint, p256dh: 'p' + id, auth: 'a' + id });

function fixture(batches, outcomes = {}) {
  const calls = { rpc: [], sent: [], reported: [], clientArgs: null };
  const client = {
    rpc: async (name, args) => {
      calls.rpc.push(name);
      if (name === 'push_claim') return { data: batches.shift() || [], error: null };
      calls.reported.push(...args.results);
      return { data: { recorded: args.results.length }, error: null };
    }
  };
  const webpush = {
    sendNotification: async (subscription, payload, options) => {
      calls.sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options });
      const outcome = outcomes[subscription.endpoint];
      if (outcome) throw Object.assign(new Error('push failed'), outcome);
      return { statusCode: 201 };
    }
  };
  const handler = createPushDispatchHandler({ env, webpush, createClient: (...args) => { calls.clientArgs = args; return client; } });
  const request = (secret = SECRET, method = 'POST') => handler(new Request('https://push.example.test/api/push-dispatch',
    { method, headers: secret == null ? {} : { 'x-push-dispatch-secret': secret } }));
  return { calls, request };
}

test('push dispatch requires the shared secret and complete settings', async () => {
  const { calls, request } = fixture([]);
  assert.equal((await request(null)).status, 404);
  assert.equal((await request('wrong')).status, 404);
  assert.equal((await request(SECRET, 'GET')).status, 405);
  assert.deepEqual(calls.rpc, [], 'nothing is read without the secret');
  for (const key of REQUIRED) {
    const handler = createPushDispatchHandler({ env: { ...env, [key]: '' }, webpush: {}, createClient: () => { throw new Error('unused'); } });
    const response = await handler(new Request('https://x.test/', { method: 'POST', headers: { 'x-push-dispatch-secret': SECRET } }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, new RegExp(key));
  }
  const short = createPushDispatchHandler({ env: { ...env, PUSH_DISPATCH_SECRET: 'short' }, webpush: {}, createClient: () => null });
  assert.equal((await short(new Request('https://x.test/', { method: 'POST', headers: { 'x-push-dispatch-secret': 'short' } }))).status, 503);
});

test('push dispatch sends to every device and reports each result', async () => {
  const payload = { title: 'New assignment', body: 'Keynote · Ballroom · Sat, Nov 7, 9:00 AM', url: '/?asg=1', tag: 'asg-1' };
  const { calls, request } = fixture([[
    { id: 1, kind: 'assignment', ttl: 43200, payload, devices: [device(1), device(2, 'https://web.push.apple.com/abc')] },
    { id: 2, kind: 'reminder', ttl: 1800, payload, devices: [device(3), device(4, 'https://evil.example.com/x')] },
    { id: 3, kind: 'test', ttl: 43200, payload, devices: [device(5)] }
  ]], {
    'https://web.push.apple.com/abc': { statusCode: 410, body: 'Unregistered' },
    'https://fcm.googleapis.com/fcm/send/3': { statusCode: 503, body: 'Service unavailable\n' },
    'https://fcm.googleapis.com/fcm/send/5': { code: 'ETIMEDOUT' }
  });
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: 3, delivered: 1, failed: 2 });
  assert.deepEqual(calls.clientArgs.slice(0, 2), [env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY]);
  assert.deepEqual(calls.rpc, ['push_claim', 'push_report']);
  assert.ok(!calls.sent.some(s => s.endpoint.includes('evil.example.com')), 'never posts to unknown services');
  const first = calls.sent.find(s => s.endpoint.endsWith('/1'));
  assert.deepEqual(first.payload, payload);
  assert.equal(first.options.TTL, 43200);
  assert.equal(first.options.urgency, 'high');
  assert.deepEqual(first.options.vapidDetails, { subject: env.VAPID_SUBJECT, publicKey: env.VITE_VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
  assert.equal(calls.sent.find(s => s.endpoint.endsWith('/3')).options.TTL, 1800, 'reminders expire after 30 minutes');
  const byId = Object.fromEntries(calls.reported.map(r => [r.id, r.devices]));
  assert.deepEqual(byId[1], [{ id: 1, ok: true, status: 201 }, { id: 2, ok: false, gone: true, status: 410, error: 'HTTP 410: Unregistered' }]);
  assert.deepEqual(byId[2], [{ id: 3, ok: false, gone: false, status: 503, error: 'HTTP 503: Service unavailable' },
    { id: 4, ok: false, gone: true, error: 'Unsupported push service' }]);
  assert.deepEqual(byId[3], [{ id: 5, ok: false, gone: false, status: null, error: 'ETIMEDOUT' }]);
});

test('push dispatch keeps claiming full batches and stops when the queue is empty', async () => {
  const full = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, kind: 'test', ttl: 60, payload: {}, devices: [device(i + 1)] }));
  const { calls, request } = fixture([full, [{ id: 99, kind: 'test', ttl: 60, payload: {}, devices: [device(99)] }]]);
  assert.deepEqual(await (await request()).json(), { claimed: 51, delivered: 51, failed: 0 });
  assert.deepEqual(calls.rpc, ['push_claim', 'push_report', 'push_claim', 'push_report']);
  const empty = fixture([]);
  assert.deepEqual(await (await empty.request()).json(), { claimed: 0, delivered: 0, failed: 0 });
  assert.deepEqual(empty.calls.rpc, ['push_claim']);
});
