import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.EVENT_OPS_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.EVENT_OPS_BROWSER || 'msedge' });
const origin = process.env.EVENT_OPS_TEST_URL || 'http://localhost:3000';
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Send sign-in link' }).waitFor();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${process.env.TEMP || '.'}/event-ops-login-${viewport.width}.png` });
  }
  // Fake API responses isolate UI integration without provisioning test users in production.
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'admin@example.test' };
  const session = { access_token: 'test', refresh_token: 'test', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user };
  let data = { revision: 0, role: 'admin', me: null, people: [], events: [], rooms: [], activities: [], asg: [], notes: [], log: [] };
  await page.route('**/*supabase.co/**', route => {
    const request = route.request();
    if (request.url().includes('/auth/v1/user')) return route.fulfill({ json: user });
    if (request.url().includes('/rest/v1/rpc/ops_snapshot')) return route.fulfill({ json: data });
    if (request.url().includes('/rest/v1/rpc/ops_command')) {
      const { action, args, expected_revision } = request.postDataJSON();
      if(expected_revision !== data.revision) return route.fulfill({ status: 409, json: { code: '40001', message: 'Another user changed the data.' } });
      if (action === 'addEvent') data.events.push({ id: 1, name: args[0].n, start: args[0].b, days: args[0].d });
      if (action === 'addRoom') data.rooms.push(args[0]);
      if (action === 'addStaff') data.people.push({ id: 0, name: args[0].n, role: args[0].r, acct: args[0].acct, phone: args[0].phone, map: 1, gone: 0 });
      if (action === 'addSession') data.activities.push({ id: 1, ev: 1, t: args[0], r: args[1], d: Number(args[2]), a: args[3], b: args[4], n: args[5] });
      data.revision++;
      return route.fulfill({ json: data });
    }
    return route.abort();
  });
  // The storage key follows the observed project URL in the repository adapter.
  const projectRef = await page.evaluate(() => {
    const entries = Object.keys(localStorage).filter(k => /^sb-.*-auth-token$/.test(k));
    return entries[0];
  });
  const source = await (await page.request.get(origin + '/src/main.js')).text();
  const project = source.match(/https:\/\/([a-z]+)\.supabase\.co/)[1];
  await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: projectRef || `sb-${project}-auth-token`, session });
  await page.reload();
  await page.getByRole('heading', { name: 'Create your first event' }).waitFor();
  await page.getByLabel('Event name', { exact: true }).fill('Test Event');
  await page.getByLabel('Start date', { exact: true }).fill('2027-03-02');
  await page.getByRole('button', { name: 'Create event', exact: true }).click();
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByLabel('Room name', { exact: true }).fill('Ballroom');
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Alex');
  await page.getByRole('button', { name: 'Add staff', exact: true }).click();
  await page.getByLabel('Activity name', { exact: true }).fill('Keynote');
  await page.getByRole('button', { name: 'Create activity', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByRole('heading', { name: 'Keynote', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Keynote', exact: true }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'Demo role' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Incoming goods', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.locator('li').filter({ hasText: 'Keynote' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Activity name', { exact: true }).fill('Stale edit');
  data = { ...data, revision: data.revision + 1 };
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole('heading', { name: 'Edit activity', exact: true }).locator('..').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Reopen the record' }).waitFor();
  assert.equal(data.activities[0].t, 'Keynote');
  assert.deepEqual(errors, []);
  console.log('Login desktop/mobile, first-event setup, persisted refresh, role controls, and stale edit protection passed.');
} finally { await browser.close(); }
