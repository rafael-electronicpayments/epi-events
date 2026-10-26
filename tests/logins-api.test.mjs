import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginHandler, temporaryPassword } from '../server/logins.js';

const PROD = 'https://abcdefghijklmnopqrst.supabase.co', SITE = 'https://epi-events-three.vercel.app';
function fixture(env = { VITE_SUPABASE_URL: PROD, SUPABASE_SECRET_KEY: 'server-test-key' }) {
  const tables = {
    people: [{ id: 0, name: 'Alex Rivera', account_type: 'staff', archived: false }, { id: 1, name: 'Sam Lee', account_type: 'admin', archived: false },
      { id: 2, name: 'Jordan Park', account_type: 'staff', archived: false }, { id: 3, name: 'Casey Moore', account_type: 'contractor', archived: false }],
    access_invites: [{ person_id: 0, email: 'alex@example.test', role: 'staff' }, { person_id: 1, email: 'sam@example.test', role: 'admin' },
      { person_id: 3, email: 'casey@example.test', role: 'staff' }],
    profiles: [{ user_id: 'admin-user', person_id: 1, role: 'admin' }, { user_id: 'staff-user', person_id: null, role: 'staff' }],
    activity_log: []
  };
  // Sam's login was made in Supabase directly (no app marker).
  const users = new Map([['admin-user', { id: 'admin-user', email: 'sam@example.test', app_metadata: {}, user_metadata: {}, last_sign_in_at: '2026-10-26T12:00:00Z' }]]);
  let n = 0, pw = 0;
  const client = {
    from(table) {
      const filters = [];
      const run = () => tables[table].filter(r => filters.every(([k, v]) => r[k] === v));
      return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
        insert: async row => { tables[table].push(row); return { error: null }; } };
    },
    auth: {
      getUser: async token => ['admin-user', 'staff-user'].includes(token) ? { data: { user: { id: token } } } : { error: new Error('bad') },
      admin: {
        listUsers: async () => ({ data: { users: [...users.values()] } }),
        createUser: async p => {
          if ([...users.values()].some(u => u.email === p.email)) return { error: new Error('exists') };
          const id = 'u' + (++n), user = { id, email: p.email, app_metadata: p.app_metadata, user_metadata: p.user_metadata, password: p.password };
          assert.equal(p.email_confirm, true);
          users.set(id, user);
          const inv = tables.access_invites.find(i => i.email === p.email);
          tables.profiles.push({ user_id: id, person_id: inv.person_id, role: inv.role });
          return { data: { user } };
        },
        updateUserById: async (id, p) => { Object.assign(users.get(id), p); return { error: null }; }
      }
    }
  };
  const handler = createLoginHandler({ env, createClient: () => client, password: () => 'Temp-Pass-' + (++pw) + 'Aa' });
  const call = (body, token = 'admin-user', origin = SITE) => handler(new Request(SITE + '/api/logins', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }));
  return { tables, users, call };
}

test('temporary passwords are readable and strong', () => {
  for (let i = 0; i < 200; i++) {
    const p = temporaryPassword();
    assert.match(p, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p));
    assert.doesNotMatch(p, /[01OIlo]/);
  }
});

test('production login API: admin only, never on staging, never changes logins made elsewhere', async () => {
  // Not on staging, nor without a server key.
  assert.equal((await fixture({ VITE_SUPABASE_URL: 'https://bqdpskxaongqrqmgnzir.supabase.co', SUPABASE_SECRET_KEY: 'k' }).call({ action: 'status' })).status, 404);
  assert.equal((await fixture({ VITE_SUPABASE_URL: PROD }).call({ action: 'status' })).status, 503);
  const f = fixture();
  assert.equal((await f.call({ action: 'status' }, null)).status, 401);
  assert.equal((await f.call({ action: 'status' }, 'staff-user')).status, 403);
  assert.equal((await f.call({ action: 'status' }, 'admin-user', 'https://evil.example')).status, 403);
  assert.equal((await f.call({ action: 'nope' })).status, 400);
  const res = await f.call({ action: 'status' });
  assert.equal(res.headers.get('cache-control'), 'private, no-store, max-age=0');
  const st = Object.fromEntries((await res.json()).people.map(p => [p.personId, p.status]));
  assert.deepEqual(st, { 0: 'none', 1: 'existing', 2: 'no-email', 3: 'type-mismatch' });

  // Create: only people without a login; the password comes back once; they must change it.
  let r = await (await f.call({ action: 'create', personIds: [0, 1, 2] })).json();
  const by = Object.fromEntries(r.results.map(x => [x.personId, x]));
  assert.deepEqual([by[0].status, by[0].password, by[0].email], ['created', 'Temp-Pass-1Aa', 'alex@example.test']);
  assert.deepEqual([by[1].status, by[1].reason, by[1].password], ['skipped', 'existing', undefined]);
  assert.deepEqual([by[2].status, by[2].reason], ['skipped', 'no-email']);
  const alex = [...f.users.values()].find(u => u.email === 'alex@example.test');
  assert.deepEqual([alex.user_metadata.must_change_password, alex.app_metadata.epi_login.person_id, alex.app_metadata.epi_login.created_by], [true, 0, 'admin-user']);
  assert.equal(f.tables.activity_log.length, 1);
  assert.ok(!JSON.stringify(f.tables.activity_log).includes('Temp-Pass'), 'passwords are never logged');

  // Status and reset for the app's login; an existing login is refused.
  r = await (await f.call({ action: 'status', personId: 0 })).json();
  assert.deepEqual([r.people[0].status, r.people[0].mustChange], ['managed', true]);
  alex.user_metadata.must_change_password = false;
  r = await (await f.call({ action: 'reset', personId: 0 })).json();
  assert.deepEqual([r.results[0].password, alex.password, alex.user_metadata.must_change_password], ['Temp-Pass-2Aa', 'Temp-Pass-2Aa', true]);
  const refused = await f.call({ action: 'reset', personId: 1 });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /made outside the app/);
  assert.equal(f.users.get('admin-user').password, undefined, 'existing login untouched');
  // Creating again skips the person who now has a login.
  r = await (await f.call({ action: 'create', personIds: [0] })).json();
  assert.deepEqual([r.results[0].status, r.results[0].reason], ['skipped', 'managed']);
  assert.equal((await f.call({ action: 'create', personIds: [99] })).status, 404);
});
