import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestLoginHandler, STAGING_REF, testPassword } from '../server/test-logins.js';

function fixture() {
  const env = { VERCEL_PROJECT_ID: 'prj_36zGiz2IizVqaJxASaPogsmURU0H',
    VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, STAGING_TEST_LOGINS_ENABLED: 'true',
    SUPABASE_SECRET_KEY: 'server-test-key', STAGING_TEST_PASSWORD_SECRET: 'test-only-secret-not-a-real-key-0000000000' };
  const tables = {
    people: [{ id: 0, name: 'Alex Rivera', account_type: 'staff', archived: false },
      { id: 1, name: 'Pat Quinn', account_type: 'contractor', archived: false }],
    access_invites: [{ person_id: 0, email: 'arivera@epieventstest.com', role: 'staff' },
      { person_id: 1, email: 'pquinn@epieventstest.com', role: 'contractor' }],
    profiles: [{ user_id: 'admin', person_id: null, role: 'admin' }, { user_id: 'staff', person_id: null, role: 'staff' }],
    activity_log: []
  };
  const users = new Map();
  let number = 0, failCreate = false;
  const client = {
    from(table) {
      const filters = [];
      const run = () => tables[table].filter(row => filters.every(([key,value]) => row[key] === value));
      return {
        select() { return this; }, eq(key,value) { filters.push([key,value]); return this; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then(resolve,reject) { return Promise.resolve({ data: run(), error: null }).then(resolve,reject); },
        insert: async row => { tables[table].push(row); return { error: null }; }
      };
    },
    auth: {
      getUser: async token => token === 'invalid' ? { error: new Error('invalid') }
        : { data: { user: { id: token, user_metadata: { role: 'admin' } } } },
      admin: {
        createUser: async payload => {
          if (failCreate) return { error: new Error('email collision') };
          const id = 'test-user-' + (++number), user = { id, email: payload.email, app_metadata: payload.app_metadata, password: payload.password };
          users.set(id,user);
          const invite = tables.access_invites.find(i => i.email === payload.email);
          tables.profiles.push({ user_id: id, role: invite.role, person_id: invite.person_id });
          assert.equal(payload.email_confirm,true);
          return { data: { user } };
        },
        getUserById: async id => ({ data: { user: users.get(id) } }),
        updateUserById: async (id,payload) => { Object.assign(users.get(id),payload); return { error: null }; }
      }
    }
  };
  let clients = 0;
  const handler = createTestLoginHandler({ env, createClient: () => { clients++; return client; } });
  const request = (body, token = 'admin', origin = 'https://staging-epi-events.vercel.app', method = 'POST', site = 'https://staging-epi-events.vercel.app') => {
    const headers = { 'Content-Type': 'application/json', Origin: origin };
    if (token) headers.Authorization = 'Bearer ' + token;
    return handler(new Request(site + '/api/test-logins', {
      method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
    }));
  };
  return { env, tables, users, request, clients: () => clients, failCreate: () => { failCreate = true; } };
}

test('test credential API is staging-only, admin-only, and noncacheable', async () => {
  const f = fixture();
  f.env.VERCEL_PROJECT_ID = 'prj_j0AEJWN4XY9XA3BXAsFJxApuDBkn';
  assert.equal((await f.request({action:'provision'})).status,404);
  assert.equal(f.clients(),0);
  f.env.VERCEL_PROJECT_ID = 'prj_36zGiz2IizVqaJxASaPogsmURU0H';
  assert.equal((await f.request({},null)).status,401);
  assert.equal((await f.request({},'invalid')).status,401);
  assert.equal((await f.request({},'staff')).status,403);
  assert.equal((await f.request({},'admin','https://unapproved.invalid')).status,403);
  // A branch domain may call its own API, but not another site's.
  const branch = 'https://push-staging-epi-events.vercel.app';
  assert.equal((await f.request({action:'credentials',personId:0},'admin',branch,'POST',branch)).status,200);
  assert.equal((await f.request({action:'credentials',personId:0},'admin',branch)).status,403);
  assert.equal((await f.request({action:'credentials',personId:0},'admin','https://unapproved.invalid','POST',branch)).status,403);
  const options = await f.request(null,null,'http://localhost:3000','OPTIONS');
  assert.equal(options.status,204);
  assert.equal(options.headers.get('access-control-allow-origin'),'http://localhost:3000');
  const response = await f.request({action:'credentials',personId:0});
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(await response.json(),{status:'pending'});
  assert.equal((await f.request({action:'credentials',personId:-1})).status,400);
  assert.equal((await f.request({action:'credentials',personId:99})).status,404);
});

test('bulk provisioning creates real linked test accounts without returning or logging passwords', async () => {
  const f = fixture();
  const summary = await (await f.request({action:'provision'})).json();
  assert.deepEqual(summary,{created:2,ready:0,skipped:0,errors:[]});
  assert.equal(f.users.size,2);
  assert.equal(f.tables.profiles.filter(p=>p.person_id!==null).length,2);
  const second = await (await f.request({action:'provision'})).json();
  assert.deepEqual(second,{created:0,ready:2,skipped:0,errors:[]});
  const credentials = await (await f.request({action:'credentials',personId:0})).json();
  assert.equal(credentials.status,'ready');
  assert.equal(credentials.password,[...f.users.values()][0].password);
  assert.ok(!JSON.stringify(f.tables.activity_log).includes(credentials.password));
  assert.ok(!JSON.stringify([...f.users.values()].map(u=>u.app_metadata)).includes(credentials.password));
  assert.ok(!JSON.stringify(summary).includes('password'));
  const reset = await (await f.request({action:'reset',personId:0})).json();
  assert.notEqual(reset.password,credentials.password);
  assert.equal(reset.password,[...f.users.values()][0].password);
  assert.equal(testPassword(f.env.STAGING_TEST_PASSWORD_SECRET,0,reset.email,[...f.users.values()][0].app_metadata.epi_test_login.version),reset.password);
});

test('real accounts, mismatched roles, archived people, and preexisting unmanaged logins are never reset', async () => {
  const f = fixture();
  f.tables.access_invites[0].email = 'real@example.test';
  f.tables.profiles.push({ user_id:'existing',person_id:1,role:'contractor' });
  f.users.set('existing',{ id:'existing',email:'pquinn@epieventstest.com',app_metadata:{},password:'unchanged' });
  assert.deepEqual(await (await f.request({action:'provision'})).json(),{created:0,ready:0,skipped:2,errors:[]});
  assert.deepEqual(await (await f.request({action:'reset',personId:0})).json(),{status:'unmanaged'});
  assert.equal((await f.request({action:'reset',personId:1})).status,409);
  assert.equal(f.users.get('existing').password,'unchanged');
  f.tables.people[1].archived = true;
  assert.equal((await f.request({action:'credentials',personId:1})).status,404);
});

test('provisioning failures are reported without claiming login access is active', async () => {
  const f = fixture(); f.failCreate();
  const summary = await (await f.request({action:'provision'})).json();
  assert.equal(summary.created,0); assert.equal(summary.errors.length,2); assert.equal(f.users.size,0);
});
