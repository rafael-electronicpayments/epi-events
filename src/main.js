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
    testLoginEndpoint: local ? 'https://staging-epi-events.vercel.app/api/test-logins' : '/api/test-logins',
    // Public half of the push key pair; the private half stays in the server's environment.
    pushKey: import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
  }) : null;
  // The service worker shows push notifications; it does not cache the app.
  if (url && key && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await import('./app.js');
}
