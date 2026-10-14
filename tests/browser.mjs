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
    if (request.url().includes('/rest/v1/rpc/ops_save_person')) {
      const {target_person_id,person,expected_revision}=request.postDataJSON();
      if(expected_revision!==data.revision)return route.fulfill({status:409,json:{code:'40001',message:'Stale edit'}});
      const row={id:target_person_id??0,name:person.n,role:person.r,acct:person.acct,phone:person.phone,email:person.email,map:1,gone:0,login:false};
      if(target_person_id===null)data.people.push(row);else data.people=data.people.map(p=>p.id===target_person_id?row:p);
      data.revision++;
      return route.fulfill({json:data});
    }
    if (request.url().includes('/rest/v1/rpc/ops_command')) {
      const { action, args, expected_revision } = request.postDataJSON();
      if(expected_revision !== data.revision) return route.fulfill({ status: 409, json: { code: '40001', message: 'Another user changed the data.' } });
      if (action === 'addEvent') data.events.push({ id: 1, name: args[0].n, start: args[0].b, days: args[0].d });
      if (action === 'addRoom') data.rooms.push(args[0]);
      if (action === 'addStaff') data.people.push({ id: 0, name: args[0].n, role: args[0].r, acct: args[0].acct, phone: args[0].phone, map: 1, gone: 0 });
      if (action === 'addSession') data.activities.push({ id: 1, ev: 1, t: args[0], r: args[1], d: Number(args[2]), a: args[3], b: args[4], n: args[5] });
      if (action === 'assign') data.asg.push({id:1,e:args[0],s:args[1],ack:0,in:0,conf:0,tag:'new'});
      if (action === 'confirm') data.asg[0].conf=1;
      if (action === 'ack') data.asg[0].ack=1;
      if (action === 'checkIn') data.asg[0].in=1;
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
  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  await page.getByLabel('Room name', { exact: true }).fill('Ballroom');
  await page.getByRole('dialog').getByRole('button', { name: 'Add room', exact: true }).click();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Alex');
  await page.getByLabel('Email', { exact: true }).fill('Alex@example.test');
  await page.getByRole('dialog').getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByText('alex@example.test',{exact:true}).waitFor();
  assert.equal(data.people[0].email,'alex@example.test');
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByRole('button', { name: 'New activity', exact: true }).click();
  await page.getByLabel('Activity name', { exact: true }).fill('Keynote');
  await page.getByRole('button', { name: 'Create activity', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Keynote', exact: true }).click();
  await page.getByLabel('Employee to assign to Keynote').selectOption('0');
  await page.getByRole('button',{name:'Assign',exact:true}).click();
  await page.getByRole('button',{name:'Coverage',exact:true}).click();
  await page.getByRole('button',{name:'Fill gap',exact:true}).click();
  await page.getByRole('button',{name:'Confirm present',exact:true}).click();
  assert.equal(data.asg[0].conf,1);
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await page.reload();
  await page.getByRole('button', { name: 'Manage Keynote', exact: true }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'Demo role' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Incoming goods', exact: true }).count(), 0);
  for(const width of [1440,1024,390,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Schedule overflow at ${width}`);
    await page.screenshot({path:`${process.env.TEMP}/event-ops-workspace-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button',{name:'Edit Alex',exact:true}).click();
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'alex@example.test');
  await page.getByLabel('Email',{exact:true}).fill('alex.updated@example.test');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('alex.updated@example.test',{exact:true}).waitFor();
  await page.setViewportSize({width:320,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'People overflow');
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await page.getByRole('button',{name:'Manage Keynote',exact:true}).click();
  await page.getByRole('button',{name:'Edit activity',exact:true}).click();
  await page.getByLabel('Activity name', { exact: true }).fill('Stale edit');
  data = { ...data, revision: data.revision + 1 };
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Reopen the record' }).waitFor();
  assert.equal(data.activities[0].t, 'Keynote');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  for(const role of ['staff','contractor']){
    data={...data,role,me:0,revision:data.revision+1};
    await page.reload();
    await page.getByRole('heading',{name:'My schedule',exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  const demo=await browser.newPage({viewport:{width:1440,height:1000}});
  demo.on('pageerror',e=>errors.push(e.message));
  await demo.route('**/src/main.js*',route=>route.fulfill({contentType:'text/javascript',body:"import '/src/standalone-shim.js'; import '/src/app.js';"}));
  await demo.goto(origin);
  await demo.getByRole('button',{name:'Manage POS Lab: demo support',exact:true}).click();
  await demo.getByLabel('Employee to assign to POS Lab: demo support').selectOption('0');
  await demo.getByRole('button',{name:'Assign',exact:true}).click();
  await demo.getByLabel('Move Alex Rivera',{exact:true}).selectOption('2');
  await demo.screenshot({path:`${process.env.TEMP}/event-ops-detail-desktop.png`,fullPage:true});
  await demo.setViewportSize({width:390,height:844});
  assert.equal(await demo.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Assignment detail overflow');
  await demo.screenshot({path:`${process.env.TEMP}/event-ops-detail-mobile.png`,fullPage:true});
  await demo.setViewportSize({width:1440,height:1000});
  await demo.getByRole('button',{name:'Close activity',exact:true}).click();
  await demo.getByRole('button',{name:'Day 2',exact:true}).click();
  await demo.getByRole('button',{name:'Day 1',exact:true}).click();
  for(const width of [1440,1024,390,320]){
    await demo.setViewportSize({width,height:1000});
    assert.equal(await demo.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Full mock overflow at ${width}`);
    if(width<=640)assert.ok(await demo.locator('.mobile-time').first().isVisible(),'Mobile rows retain times');
    await demo.screenshot({path:`${process.env.TEMP}/event-ops-full-${width}.png`,fullPage:true});
  }
  await demo.setViewportSize({width:1440,height:1000});
  await demo.emulateMedia({colorScheme:'dark'});
  await demo.screenshot({path:`${process.env.TEMP}/event-ops-dark.png`,fullPage:true});
  await demo.emulateMedia({colorScheme:'light'});
  await demo.getByRole('button',{name:'Schedule grid',exact:true}).click();
  const download=demo.waitForEvent('download');
  await demo.getByRole('button',{name:'Download printable schedule',exact:true}).click();
  assert.ok((await download).suggestedFilename().endsWith('.html'));
  await demo.getByLabel('Event',{exact:true}).selectOption('2');
  await demo.getByRole('button',{name:'List view',exact:true}).click();
  await demo.getByRole('heading',{name:'No activities scheduled',exact:true}).waitFor();
  await demo.getByRole('button',{name:'People',exact:true}).click();
  await demo.getByLabel('Search people').fill('not-a-person');
  await demo.getByText('No records found.',{exact:true}).waitFor();
  await demo.close();
  assert.deepEqual(errors, []);
  console.log('Login, setup dialogs, people email editing, assignment/coverage, responsive workspace, staff/contractor access, and stale edit protection passed.');
} finally { await browser.close(); }
