import { createClient } from '@supabase/supabase-js';
import './standalone-shim.js';
import { createRepository } from './repository.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (Boolean(url) !== Boolean(key)) {
  document.getElementById('root').textContent = 'Supabase configuration is incomplete.';
} else {
  const passwordRecovery = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  window.eventOpsRepository = url && key ? createRepository(createClient(url, key), {
    passwordRecovery,
    testLoginsEnabled: new URL(url).hostname === 'bqdpskxaongqrqmgnzir.supabase.co',
    testLoginEndpoint: local ? 'https://staging-epi-events.vercel.app/api/test-logins' : '/api/test-logins'
  }) : null;
  await import('./app.js');
}
