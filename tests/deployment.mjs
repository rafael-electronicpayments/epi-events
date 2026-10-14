import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.EVENT_OPS_PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.EVENT_OPS_TEST_URL;
assert.ok(origin?.startsWith('https://'), 'Set EVENT_OPS_TEST_URL to the deployed HTTPS URL');
const browser = await chromium.launch({ headless: true, channel: process.env.EVENT_OPS_BROWSER || 'msedge' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(origin);
  assert.equal(response.status(), 200, 'Production must be accessible without Vercel authentication');
  await page.getByRole('button', { name: 'Send sign-in link' }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'Demo role' }).count(), 0);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${process.env.TEMP || '.'}/event-ops-production-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('Public production URL, connected login, and desktop/mobile rendering passed.');
} finally { await browser.close(); }
