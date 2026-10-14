import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), 'VITE_');
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building for deployment.');
}
const project = new URL(url);
if (project.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(project.hostname)) {
  throw new Error('The deployed Supabase project URL must use HTTPS.');
}
let publicKey = key.startsWith('sb_publishable_');
if (!publicKey) {
  try {
    publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
  } catch { publicKey = false; }
}
if (!publicKey) throw new Error('Use a publishable or legacy anon key, never a secret or service-role key.');
const targets = {
  prj_j0AEJWN4XY9XA3BXAsFJxApuDBkn: 'nrzyqctclteswzsvxifo.supabase.co',
  prj_36zGiz2IizVqaJxASaPogsmURU0H: 'bqdpskxaongqrqmgnzir.supabase.co'
};
const expectedHost = targets[process.env.VERCEL_PROJECT_ID];
if (expectedHost && project.hostname !== expectedHost) {
  throw new Error('Supabase project does not match the target Vercel environment. Deployment stopped.');
}
console.log('Deployment Supabase configuration is present and target checks passed.');
