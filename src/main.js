import { createClient } from '@supabase/supabase-js';
import './standalone-shim.js';
import { createRepository } from './repository.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (Boolean(url) !== Boolean(key)) {
  document.getElementById('root').textContent = 'Supabase configuration is incomplete.';
} else {
  window.eventOpsRepository = url && key ? createRepository(createClient(url, key)) : null;
  await import('./app.js');
}
