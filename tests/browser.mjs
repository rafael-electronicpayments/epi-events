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
  await page.getByRole('button', { name: 'Sign in',exact:true }).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);
  await page.getByLabel('Password',{exact:true}).waitFor();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${process.env.TEMP || '.'}/event-ops-login-${viewport.width}.png` });
  }
  // Fake API responses isolate UI integration without provisioning test users in production.
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'admin@example.test' };
  const session = { access_token: 'test', refresh_token: 'test', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user };
  let data = { revision: 0, role: 'admin', me: null, people: [], events: [], rooms: [], activities: [], asg: [], notes: [], log: [] };
  let passwordVersion=1;
  const testCredentials=()=>({status:'ready',email:data.people[0].email,password:'Fixture-only-password-'+passwordVersion});
  await page.route('**/api/test-logins',route=>{
    assert.equal(route.request().headers().authorization,'Bearer test');
    if(data.role!=='admin')return route.fulfill({status:403,json:{error:'Administrator access required.'}});
    const body=route.request().postDataJSON();
    if(body.action==='credentials')return route.fulfill({json:data.people[0].login?testCredentials():{status:'pending'}});
    if(body.action==='reset'){data.people[0].login=true;passwordVersion++;return route.fulfill({json:testCredentials()});}
    const created=data.people.filter(p=>!p.login).length;
    data.people.forEach(p=>p.login=true);
    return route.fulfill({json:{created,ready:data.people.length-created,skipped:0,errors:[]}});
  });
  await page.route('**/*supabase.co/**', route => {
    const request = route.request();
    if(request.url().includes('/auth/v1/recover'))return route.fulfill({json:{}});
    if(request.url().includes('/auth/v1/token')){
      const payload=request.postDataJSON();
      assert.equal(payload.email,'admin@example.test');
      return payload.password==='test-password' ? route.fulfill({json:session})
        : route.fulfill({status:400,json:{code:'invalid_credentials',message:'Invalid login credentials'}});
    }
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
  await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
  await page.getByLabel('Email address').fill('admin@example.test');
  await page.getByRole('button',{name:'Send reset link',exact:true}).click();
  await page.getByRole('status').filter({hasText:'password reset link has been sent'}).waitFor();
  await page.getByRole('button',{name:'Back to sign in',exact:true}).click();
  await page.getByLabel('Password',{exact:true}).fill('wrong-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Unable to sign in'}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);
  await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Show password',exact:true}).click();
  assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text');
  await page.getByRole('button',{name:'Hide password',exact:true}).click();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
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
  await page.getByLabel('Email', { exact: true }).fill('Alex@epieventstest.com');
  await page.getByRole('dialog').getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByText('alex@epieventstest.com',{exact:true}).waitFor();
  assert.equal(data.people[0].email,'alex@epieventstest.com');
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Edit Alex',exact:true}).click();
  await page.getByRole('button',{name:'Create test login',exact:true}).click();
  await page.getByLabel('Temporary password',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Temporary password',{exact:true}).getAttribute('type'),'password');
  await page.getByRole('button',{name:'Show temporary password',exact:true}).click();
  assert.equal(await page.getByLabel('Temporary password',{exact:true}).getAttribute('type'),'text');
  assert.equal(await page.getByLabel('Temporary password',{exact:true}).inputValue(),'Fixture-only-password-2');
  await page.getByRole('button',{name:'Hide temporary password',exact:true}).click();
  await page.getByRole('button',{name:'Reset temporary password',exact:true}).click();
  await page.getByRole('button',{name:'Confirm password reset',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Temporary password"]')?.value==='Fixture-only-password-3');
  assert.equal(await page.getByLabel('Temporary password',{exact:true}).inputValue(),'Fixture-only-password-3');
  await page.screenshot({path:`${process.env.TEMP}/event-ops-test-login-desktop.png`,fullPage:true});
  await page.setViewportSize({width:320,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Test credential dialog overflow');
  await page.screenshot({path:`${process.env.TEMP}/event-ops-test-login-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByText('Login active',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Create test logins',exact:true}).click();
  await page.getByRole('status').filter({hasText:'0 created'}).waitFor();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByRole('button', { name: 'New activity', exact: true }).click();
  await page.getByLabel('Activity name', { exact: true }).fill('Keynote');
  await page.getByRole('button', { name: 'Create activity', exact: true }).click();
  await page.getByRole('button', { name: 'Event setup', exact: true }).click();
  for (const [tab, name] of [['Event details','Test Event'],['Rooms','Ballroom'],['Activities','Keynote']]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const row = page.getByRole('row').filter({has:page.getByRole('button',{name:'Edit '+name,exact:true})});
    assert.equal(await row.getByRole('cell').first().getByRole('button',{name:'Edit '+name,exact:true}).count(),1);
    assert.equal(await row.getByRole('cell').first().getByRole('button',{name:'Delete '+name,exact:true}).count(),1);
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      const edit=await row.getByRole('button',{name:'Edit '+name,exact:true}).boundingBox();
      const label=await row.getByRole('cell').nth(1).boundingBox();
      assert.ok(edit.x+edit.width<=label.x,'Setup controls precede record details');
      await page.screenshot({path:`${process.env.TEMP}/event-ops-setup-${tab.replaceAll(' ','-')}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
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
  {
    const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'Edit Alex',exact:true})});
    assert.equal(await row.getByRole('cell').first().getByRole('button',{name:'Edit Alex',exact:true}).count(),1);
    assert.equal(await row.getByRole('cell').first().getByRole('button',{name:'Delete Alex',exact:true}).count(),1);
    const edit=await row.getByRole('button',{name:'Edit Alex',exact:true}).boundingBox();
    const label=await row.getByRole('cell').nth(1).boundingBox();
    assert.ok(edit.x+edit.width<=label.x,'People controls precede record details');
  }
  await page.getByRole('button',{name:'Edit Alex',exact:true}).click();
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'alex@epieventstest.com');
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
  if(['localhost','127.0.0.1'].includes(new URL(origin).hostname)){
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
  }
  assert.deepEqual(errors, []);
  console.log('Login, setup dialogs, people email editing, assignment/coverage, responsive workspace, staff/contractor access, and stale edit protection passed.');
} finally { await browser.close(); }
