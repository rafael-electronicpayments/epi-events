import { timingSafeEqual } from 'node:crypto';

// Sends due push notifications. Called once a minute by pg_cron (via pg_net) with a shared secret header.
// The database decides what is due and still wanted (push_claim) and records every device's result (push_report).
export const PUSH_SERVICES = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;
export const REQUIRED = ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VITE_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const BATCH = 50;

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
const describe = e => String(e.statusCode
  ? 'HTTP ' + e.statusCode + (e.body ? ': ' + String(e.body).replace(/\s+/g, ' ').trim() : '')
  : e.code || e.message || 'Send failed').slice(0, 300);

export function createPushDispatchHandler({ createClient, webpush, env, now = () => Date.now(), budgetMs = 20000 }) {
  return async request => {
    const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    const secret = env.PUSH_DISPATCH_SECRET;
    if (!secret || secret.length < 32) return reply({ error: 'Push sending is not set up.' }, 503);
    // Anyone without the secret gets the same answer as a missing page.
    if (!same(request.headers.get('x-push-dispatch-secret'), secret)) return reply({ error: 'Not found.' }, 404);
    const missing = REQUIRED.filter(k => !env[k]);
    if (missing.length) return reply({ error: 'Missing settings: ' + missing.join(', ') }, 503);
    const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const vapidDetails = { subject: env.VAPID_SUBJECT, publicKey: env.VITE_VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
    const send = async (item, d) => {
      if (!PUSH_SERVICES.test(d.endpoint)) return { id: d.id, ok: false, gone: true, error: 'Unsupported push service' };
      try {
        const r = await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify(item.payload), { vapidDetails, TTL: item.ttl, urgency: 'high', timeout: 8000 });
        return { id: d.id, ok: true, status: r?.statusCode ?? null };
      } catch (e) {
        const status = e?.statusCode ?? null;
        // 404/410: the device unsubscribed or the app was removed. Anything else is retried.
        return { id: d.id, ok: false, gone: status === 404 || status === 410, status, error: describe(e || {}) };
      }
    };
    const started = now();
    let claimed = 0, delivered = 0, failed = 0;
    while (now() - started < budgetMs) {
      const { data: batch, error } = await client.rpc('push_claim', { max_rows: BATCH });
      if (error) return reply({ error: 'Could not read the queue.', claimed, delivered, failed }, 502);
      if (!Array.isArray(batch) || !batch.length) break;
      claimed += batch.length;
      const results = await Promise.all(batch.map(async item => ({ id: item.id, devices: await Promise.all((item.devices || []).map(d => send(item, d))) })));
      for (const r of results) r.devices.some(d => d.ok) ? delivered++ : failed++;
      const { error: reportError } = await client.rpc('push_report', { results });
      if (reportError) return reply({ error: 'Could not record results.', claimed, delivered, failed }, 502);
      if (batch.length < BATCH) break;
    }
    return reply({ claimed, delivered, failed });
  };
}
