import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';

test('password login uses Supabase password auth and never falls back to OTP or sign up', async () => {
  let observed;
  const repository = createRepository({ auth: { signInWithPassword: async payload => {
    observed = payload; return {data:{session:{user:{id:'test-user'}}},error:null};
  } } });
  await repository.signIn('person@example.test','test-only-password');
  assert.deepEqual(observed,{email:'person@example.test',password:'test-only-password'});
  assert.equal(repository.testLoginsEnabled,false);
  await assert.rejects(repository.testLogins('provision'),/staging only/);
});

test('signed-in password change confirms the current password before setting the new one', async () => {
  const calls = [];
  const auth = {
    getSession: async () => ({ data: { session: { user: { email: 'person@example.test' } } }, error: null }),
    signInWithPassword: async p => { calls.push(['check', p]); return p.password === 'right-current-pass' ? { data: {}, error: null } : { data: null, error: new Error('Invalid login credentials') }; },
    updateUser: async p => { calls.push(['update', p]); return { data: {}, error: null }; }
  };
  const repository = createRepository({ auth });
  await assert.rejects(repository.changePassword('wrong', 'a-brand-new-password'), e => e.code === 'wrong_password');
  assert.deepEqual(calls.map(c => c[0]), ['check'], 'no update after a wrong current password');
  await repository.changePassword('right-current-pass', 'a-brand-new-password');
  assert.deepEqual(calls.at(-2), ['check', { email: 'person@example.test', password: 'right-current-pass' }]);
  assert.deepEqual(calls.at(-1), ['update', { password: 'a-brand-new-password' }]);
});

test('a request refused for an expired sign-in token renews the session and is sent once more', async () => {
  let rpcCalls = 0, refreshes = 0, fail = 1;
  const client = {
    auth: { refreshSession: async () => { refreshes++; return { data: { session: { access_token: 'new' } }, error: null }; } },
    rpc: async name => { rpcCalls++; return fail-- > 0 ? { data: null, error: { code: 'PGRST301', message: 'JWT expired' } } : { data: { revision: 7, name }, error: null }; }
  };
  const repository = createRepository(client);
  assert.deepEqual(await repository.load(), { revision: 7, name: 'ops_snapshot' });
  assert.deepEqual([rpcCalls, refreshes], [2, 1]);
  // Other errors are not retried.
  client.rpc = async () => { rpcCalls++; return { data: null, error: { code: '42501', message: 'Access denied.' } }; };
  await assert.rejects(repository.command('ack', [1], 3), e => e.code === '42501');
  assert.deepEqual([rpcCalls, refreshes], [3, 1]);
  // If renewing fails, the original error stands (no second send).
  client.rpc = async () => { rpcCalls++; return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } }; };
  client.auth.refreshSession = async () => { refreshes++; return { data: { session: null }, error: new Error('offline') }; };
  await assert.rejects(repository.load(), e => e.code === 'PGRST301');
  assert.deepEqual([rpcCalls, refreshes], [4, 2]);
});
