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
