// Admin-created sign-in logins for production (People › Login). No email is sent: the admin gets a temporary
// password once and hands it over; the person must choose their own password at first sign-in.
// Only logins this tool created (marked in app_metadata.epi_login) can be reset. Logins made anywhere else (for
// example in Supabase directly) are shown as "existing" and never changed. Staging keeps its own test logins.
import { randomInt } from 'node:crypto';
import { STAGING_REF } from './test-logins.js';

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Readable temporary password, e.g. "Kp7m-Q2xz-9Hdw-T4rn": no look-alike characters, always upper, lower, and digit.
const LOWER = 'abcdefghijkmnpqrstuvwxyz', UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', DIGIT = '23456789', ALL = LOWER + UPPER + DIGIT;
export function temporaryPassword(rand = randomInt) {
  const pick = s => s[rand(s.length)];
  for (;;) {
    const groups = [0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => pick(ALL)).join(''));
    const p = groups.join('-');
    if (/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)) return p;
  }
}

export function createLoginHandler({ createClient, env, password = temporaryPassword, now = () => new Date() }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Origin' };
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    try {
      const url = env.VITE_SUPABASE_URL || '';
      if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) || url === `https://${STAGING_REF}.supabase.co`) return reply({ error: 'Not found.' }, 404);
      const origin = request.headers.get('origin'), own = new URL(request.url).origin;
      if (origin && origin !== own) return reply({ error: 'Origin not allowed.' }, 403);
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) return reply({ error: 'Sign in required.' }, 401);
      if (!env.SUPABASE_SECRET_KEY) return reply({ error: 'Login setup is incomplete: the server key is missing.' }, 503);
      const client = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: identity, error: authError } = await client.auth.getUser(token);
      if (authError || !identity?.user) return reply({ error: 'Sign in required.' }, 401);
      const actor = identity.user.id;
      const { data: me, error: meError } = await client.from('profiles').select('role').eq('user_id', actor).maybeSingle();
      if (meError || me?.role !== 'admin') return reply({ error: 'Administrator access required.' }, 403);

      let body;
      try { body = await request.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
      const { action } = body || {};
      const ids = Array.isArray(body?.personIds) ? body.personIds : body?.personId !== undefined ? [body.personId] : [];
      if (!['status', 'create', 'reset'].includes(action) || ids.some(i => !Number.isInteger(i) || i < 0) || ids.length > 500
        || (action === 'reset' && ids.length !== 1) || (action === 'create' && !ids.length)) return reply({ error: 'Invalid request.' }, 400);

      const [{ data: people, error: e1 }, { data: invites, error: e2 }, { data: profiles, error: e3 }] = await Promise.all([
        client.from('people').select('id,name,account_type').eq('archived', false),
        client.from('access_invites').select('person_id,email,role'),
        client.from('profiles').select('user_id,person_id,role')]);
      if (e1 || e2 || e3) throw new Error('Roster lookup failed');
      // Every login, once (paged), to tell this tool's logins from existing ones.
      const users = new Map();
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error('Login lookup failed');
        for (const u of data?.users || []) users.set(u.id, u);
        if (!data?.users || data.users.length < 1000) break;
      }
      const byEmail = email => [...users.values()].find(u => (u.email || '').toLowerCase() === email);
      const inviteOf = p => invites.find(i => i.person_id === p.id);
      // none: can create · managed: created here (can reset) · existing: made elsewhere · no-email / type-mismatch: fix People first
      const state = p => {
        const inv = inviteOf(p), email = (inv?.email || '').toLowerCase();
        if (!inv || !EMAIL.test(email)) return { status: 'no-email' };
        if (inv.role !== p.account_type) return { status: 'type-mismatch', email };
        const linked = profiles.find(f => f.person_id === p.id), user = linked ? users.get(linked.user_id) : byEmail(email);
        if (!user) return { status: 'none', email };
        const mark = user.app_metadata?.epi_login;
        const info = { email, lastSignIn: user.last_sign_in_at || null, mustChange: !!user.user_metadata?.must_change_password };
        if (mark && mark.person_id === p.id && (user.email || '').toLowerCase() === email && linked?.user_id === user.id) return { status: 'managed', user, ...info };
        return { status: 'existing', ...info };
      };
      const view = (p, s) => ({ personId: p.id, status: s.status, email: s.email || null, lastSignIn: s.lastSignIn || null, mustChange: !!s.mustChange });
      const log = async (what, details) => {
        const { error } = await client.from('activity_log').insert({ actor_id: actor, action: what, details });
        if (error) console.error('login_audit_failed');
      };

      if (action === 'status') {
        const list = ids.length ? people.filter(p => ids.includes(p.id)) : people;
        return reply({ people: list.map(p => view(p, state(p))) });
      }
      const chosen = ids.map(i => people.find(p => p.id === i));
      if (chosen.some(p => !p)) return reply({ error: 'Someone you chose is no longer in People. Refresh and try again.' }, 404);

      if (action === 'reset') {
        const p = chosen[0], s = state(p);
        if (s.status === 'existing') return reply({ error: 'This login was made outside the app, so its password can\'t be reset here. Reset it in Supabase.' }, 409);
        if (s.status !== 'managed') return reply({ error: 'This person has no login yet. Use Create login.' }, 409);
        const pw = password();
        const { error } = await client.auth.admin.updateUserById(s.user.id, { password: pw, user_metadata: { ...(s.user.user_metadata || {}), must_change_password: true } });
        if (error) throw new RequestError(409, 'Could not reset the password. Try again.');
        await log('Reset login password', { person_id: p.id, name: p.name });
        return reply({ results: [{ personId: p.id, name: p.name, email: s.email, password: pw, status: 'reset' }] });
      }

      // create: one or many; people who already have a login (any kind) or aren't ready are skipped, never changed.
      const results = [];
      for (let i = 0; i < chosen.length; i += 3) {
        await Promise.all(chosen.slice(i, i + 3).map(async p => {
          const s = state(p);
          if (s.status !== 'none') { results.push({ personId: p.id, name: p.name, email: s.email || null, status: 'skipped', reason: s.status }); return; }
          const pw = password();
          const { data, error } = await client.auth.admin.createUser({ email: s.email, password: pw, email_confirm: true,
            app_metadata: { epi_login: { person_id: p.id, created_by: actor, created_at: now().toISOString() } },
            user_metadata: { must_change_password: true } });
          if (error || !data?.user) { results.push({ personId: p.id, name: p.name, email: s.email, status: 'failed', reason: 'Could not create the login (the email may already have one).' }); return; }
          const { data: link } = await client.from('profiles').select('person_id,role').eq('user_id', data.user.id).maybeSingle();
          if (link?.person_id !== p.id || link?.role !== p.account_type) {
            results.push({ personId: p.id, name: p.name, email: s.email, password: pw, status: 'check', reason: 'Login created, but it isn\'t linked to this person yet. Check their email and type in People.' });
            return;
          }
          results.push({ personId: p.id, name: p.name, email: s.email, password: pw, status: 'created' });
        }));
      }
      const made = results.filter(r => r.status === 'created' || r.status === 'check').length;
      if (made) await log(made === 1 ? 'Created a login' : 'Created logins', { count: made, people: results.filter(r => r.password).map(r => r.personId) });
      results.sort((a, b) => a.name.localeCompare(b.name));
      return reply({ results });
    } catch (error) {
      if (!(error instanceof RequestError)) console.error('login_operation_failed');
      return reply({ error: error instanceof RequestError ? error.message : 'The login request failed. Try again.' }, error.status || 500);
    }
  };
}
