import { createHmac, randomUUID } from 'node:crypto';

export const STAGING_REF = 'bqdpskxaongqrqmgnzir';
const STAGING_PROJECT = 'prj_36zGiz2IizVqaJxASaPogsmURU0H';
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function testPassword(secret, personId, email, version) {
  return createHmac('sha256', secret).update(JSON.stringify(['epi-staging-test-v1', personId, email, version]))
    .digest('base64url').slice(0, 24) + 'Aa9!';
}

export function createTestLoginHandler({ createClient, env, uuid = randomUUID }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Origin' };
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    try {
      if (env.VERCEL_PROJECT_ID !== STAGING_PROJECT || env.VITE_SUPABASE_URL !== `https://${STAGING_REF}.supabase.co`
        || env.STAGING_TEST_LOGINS_ENABLED !== 'true') return reply({ error: 'Not found.' }, 404);
      const origin = request.headers.get('origin');
      const origins = ['https://staging-epi-events.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:3000'];
      if (env.VERCEL_URL) origins.push('https://' + env.VERCEL_URL);
      if (origin && !origins.includes(origin)) return reply({ error: 'Origin not allowed.' }, 403);
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      if (request.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) return reply({ error: 'Sign in required.' }, 401);
      if (!env.SUPABASE_SECRET_KEY || !env.STAGING_TEST_PASSWORD_SECRET || env.STAGING_TEST_PASSWORD_SECRET.length < 32) {
        return reply({ error: 'Staging test login setup is incomplete.' }, 503);
      }
      const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: identity, error: authError } = await client.auth.getUser(token);
      if (authError || !identity?.user) return reply({ error: 'Sign in required.' }, 401);
      const actor = identity.user.id;
      const { data: profile, error: profileError } = await client.from('profiles').select('role').eq('user_id', actor).maybeSingle();
      if (profileError || profile?.role !== 'admin') return reply({ error: 'Administrator access required.' }, 403);
      let body;
      try { body = await request.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
      const { action, personId } = body || {};
      if (!['credentials', 'provision', 'reset'].includes(action)
        || (personId !== undefined && (!Number.isInteger(personId) || personId < 0))
        || (action !== 'provision' && personId === undefined)) return reply({ error: 'Invalid request.' }, 400);
      const { data: people, error: peopleError } = await client.from('people').select('id,name,account_type').eq('archived', false);
      const { data: invitations, error: inviteError } = await client.from('access_invites').select('person_id,email,role');
      const { data: profiles, error: profilesError } = await client.from('profiles').select('user_id,person_id,role');
      if (peopleError || inviteError || profilesError) throw new Error('Roster lookup failed');
      const records = people.filter(p => personId === undefined || p.id === personId);
      if (personId !== undefined && !records.length) return reply({ error: 'Person no longer exists.' }, 404);
      const inviteFor = p => invitations.find(i => i.person_id === p.id);
      const eligible = p => {
        const invite = inviteFor(p);
        return invite && /^[a-z0-9]+@epieventstest\.com$/.test(invite.email) && invite.role === p.account_type
          && ['staff', 'contractor'].includes(p.account_type);
      };
      const inspect = async p => {
        const linked = profiles.find(f => f.person_id === p.id);
        if (!linked) return { status: 'pending' };
        if (linked.role !== p.account_type) return { status: 'unmanaged' };
        const { data, error } = await client.auth.admin.getUserById(linked.user_id);
        if (error || !data?.user) throw new Error('Account lookup failed');
        const user = data.user, marker = user.app_metadata?.epi_test_login;
        if (marker?.project_ref !== STAGING_REF || marker.person_id !== p.id
          || typeof marker.version !== 'string' || marker.version.length < 16
          || user.email?.toLowerCase() !== inviteFor(p).email) return { status: 'unmanaged' };
        return { status: 'ready', user, version: marker.version };
      };
      const credentials = (p, version) => ({ status: 'ready', email: inviteFor(p).email,
        password: testPassword(env.STAGING_TEST_PASSWORD_SECRET, p.id, inviteFor(p).email, version) });
      const create = async p => {
        const version = uuid(), invite = inviteFor(p);
        const { data, error } = await client.auth.admin.createUser({ email: invite.email,
          password: testPassword(env.STAGING_TEST_PASSWORD_SECRET, p.id, invite.email, version),
          email_confirm: true,
          app_metadata: { epi_test_login: { project_ref: STAGING_REF, person_id: p.id, version } }
        });
        if (error || !data?.user) throw new RequestError(409, 'Could not create this test account; check for an existing email account.');
        const { data: linked, error: linkError } = await client.from('profiles').select('person_id,role').eq('user_id', data.user.id).maybeSingle();
        if (linkError || linked?.person_id !== p.id || linked.role !== p.account_type) {
          throw new RequestError(409, 'The roster changed while creating this account. Review its login link before retrying.');
        }
        return version;
      };
      if (action === 'credentials' || action === 'reset') {
        const person = records[0];
        if (!eligible(person)) return reply({ status: 'unmanaged' });
        const state = await inspect(person);
        if (action === 'credentials') return reply(state.status === 'ready' ? credentials(person, state.version) : { status: state.status });
        if (state.status === 'unmanaged') return reply({ error: 'Existing account passwords cannot be viewed or reset here.' }, 409);
        const version = state.status === 'pending' ? await create(person) : uuid();
        if (state.status === 'ready') {
          const { error } = await client.auth.admin.updateUserById(state.user.id, {
            password: testPassword(env.STAGING_TEST_PASSWORD_SECRET, person.id, inviteFor(person).email, version),
            app_metadata: { ...state.user.app_metadata, epi_test_login: { project_ref: STAGING_REF, person_id: person.id, version } }
          });
          if (error) throw new RequestError(409, 'Could not reset the test password.');
        }
        const { error: logError } = await client.from('activity_log').insert({ actor_id: actor,
          action: state.status === 'pending' ? 'Created staging test login' : 'Reset staging test password', details: { person_id: person.id } });
        if (logError) console.error('staging_test_login_audit_failed');
        return reply(credentials(person, version));
      }
      const summary = { created: 0, ready: 0, skipped: 0, errors: [] };
      // Bound concurrency to keep Auth provisioning within its service limits.
      for (let i = 0; i < records.length; i += 3) {
        await Promise.all(records.slice(i, i + 3).map(async p => {
          if (!eligible(p)) { summary.skipped++; return; }
          try {
            const state = await inspect(p);
            if (state.status === 'pending') { await create(p); summary.created++; }
            else if (state.status === 'ready') summary.ready++;
            else summary.skipped++;
          } catch { summary.errors.push({ personId: p.id, message: 'Account could not be provisioned.' }); }
        }));
      }
      if (summary.created) {
        const { error: logError } = await client.from('activity_log').insert({ actor_id: actor,
          action: 'Provisioned staging test logins', details: { created: summary.created, skipped: summary.skipped, failed: summary.errors.length } });
        if (logError) console.error('staging_test_login_audit_failed');
      }
      return reply(summary);
    } catch (error) {
      if (!(error instanceof RequestError)) console.error('staging_test_login_operation_failed');
      return reply({ error: error instanceof RequestError ? error.message : 'Test login operation failed. Try again.' }, error.status || 500);
    }
  };
}
