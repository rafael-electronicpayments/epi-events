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
