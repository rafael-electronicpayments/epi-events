import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const production = { id: 'prj_j0AEJWN4XY9XA3BXAsFJxApuDBkn', ref: 'nrzyqctclteswzsvxifo' };
const staging = { id: 'prj_36zGiz2IizVqaJxASaPogsmURU0H', ref: 'bqdpskxaongqrqmgnzir' };

for (const site of [production, staging]) {
  for (const database of [production, staging]) {
    test(`deployment ${site.id === staging.id ? 'staging' : 'production'} accepts only its own database (${database.ref})`, () => {
      const result = spawnSync(process.execPath, ['scripts/validate-config.mjs'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, VERCEL_PROJECT_ID: site.id,
          VITE_SUPABASE_URL: `https://${database.ref}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_configuration_test' }
      });
      assert.equal(result.status, site.id === database.id ? 0 : 1, result.stderr);
      if (site.id !== database.id) assert.match(result.stderr, /does not match the target Vercel environment/);
    });
  }
}
