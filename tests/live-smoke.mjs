import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
const env = loadEnv('development', process.cwd(), 'VITE_');
assert.ok(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Supabase configuration is required');
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const { error } = await client.rpc('ops_snapshot');
assert.equal(error?.code, '42501');
const events = await client.from('events').select('id');
assert.equal(events.error?.code, '42501');
console.log('Live Supabase is reachable; anonymous snapshot and table access are denied.');
