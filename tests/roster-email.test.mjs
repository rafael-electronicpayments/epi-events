import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('roster emails provision access and reject collisions or unauthorized changes',async()=>{
  const db=new PGlite();
  const admin='00000000-0000-0000-0000-000000000001';
  const staff='00000000-0000-0000-0000-000000000002';
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const dir=new URL('../supabase/migrations/',import.meta.url);
    for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
    await db.exec(`insert into public.access_invites(email,role) values('admin@example.test','admin');
      insert into auth.users values('${admin}','admin@example.test');
      select set_config('request.jwt.claim.sub','${admin}',false);`);
    const snapshot=async()=> (await db.query('select public.ops_snapshot() as s')).rows[0].s;
    const save=async(id,email,acct='staff',revision)=> (await db.query('select public.ops_save_person($1,$2::jsonb,$3) as s',[
      id,JSON.stringify({n:'Test Person',r:'Host',acct,phone:'',map:false,email}),revision??(await snapshot()).revision])).rows[0].s;
    let s=await save(null,'  Staff@Example.test  ');
    const person=s.people[0].id;
    assert.equal(s.people[0].email,'staff@example.test');
    assert.equal(s.people[0].login,false);
    await assert.rejects(save(null,'staff@example.test'),/already belongs/);
    await assert.rejects(save(null,'admin@example.test'),/already belongs/);
    await assert.rejects(save(null,'invalid'),/valid email/);
    await assert.rejects(save(person,'staff@example.test','manager'),/Choose Admin, Staff, Event Staff, Speaker, or Panelist/);
    await db.exec(`insert into auth.users values('${staff}','staff@example.test')`);
    assert.equal((await db.query('select role from public.profiles where user_id=$1',[staff])).rows[0].role,'staff');
    s=await save(person,'staff@example.test','contractor');
    assert.equal(s.people[0].login,true);
    assert.equal((await db.query('select role from public.profiles where user_id=$1',[staff])).rows[0].role,'contractor');
    const old=s.revision;
    s=await save(person,'staff@example.test','staff');
    await assert.rejects(save(person,'new@example.test','staff',old),/Another user changed/);
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); set role authenticated;`);
    await assert.rejects(save(person,'stolen@example.test'),/Administrator access/);
    await assert.rejects(db.exec('select ops_private.ops_snapshot_base()'),/permission denied/);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${admin}',false);`);
    s=await save(person,'new@example.test');
    assert.equal(s.people[0].email,'new@example.test');
    assert.equal(s.people[0].login,false);
    assert.equal((await db.query('select count(*)::int n from public.profiles where user_id=$1',[staff])).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from public.access_invites where email='staff@example.test'")).rows[0].n,0);
    s=await save(person,'');
    assert.equal(s.people[0].email,'');
    assert.equal((await db.query('select count(*)::int n from public.access_invites where person_id=$1',[person])).rows[0].n,0);
    // Auth users created before entering the roster email link immediately.
    s=await save(person,'staff@example.test');
    assert.equal(s.people[0].login,true);
    // Legacy commands still return the enriched snapshot after the wrapper migration.
    const legacy=(await db.query("select public.ops_command('addRoom','[\"Room\"]'::jsonb,$1) as s",[s.revision])).rows[0].s;
    assert.equal(legacy.people[0].email,'staff@example.test');
    const role=async id=>(await db.query('select role from public.profiles where user_id=$1',[id])).rows[0]?.role;
    // Admin is a People type with full administrator access.
    s=await save(person,'staff@example.test','admin');
    assert.equal(s.people.find(p=>p.id===person).acct,'admin');
    assert.equal(await role(staff),'admin');
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false)`);
    assert.equal((await snapshot()).role,'admin');
    await assert.rejects(save(person,'staff@example.test','staff'),/your own administrator access/);
    await assert.rejects(db.query("select public.ops_command('delStaff',$1::jsonb,$2)",[JSON.stringify([person]),(await snapshot()).revision]),/your own access/);
    // A standalone administrator login can be linked to the roster, but only as Admin.
    await assert.rejects(save(null,'admin@example.test','staff'),/already belongs|administrator/);
    s=await save(null,'admin@example.test','admin');
    const adminPerson=s.people.find(p=>p.email==='admin@example.test').id;
    assert.equal((await db.query('select person_id from public.profiles where user_id=$1',[admin])).rows[0].person_id,adminPerson);
    // Demoting or archiving an Admin person removes administrator access.
    await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`);
    s=await save(person,'staff@example.test','staff');
    assert.equal(await role(staff),'staff');
    s=await save(person,'staff@example.test','admin');
    await db.query("select public.ops_command('delStaff',$1::jsonb,$2)",[JSON.stringify([person]),s.revision]);
    assert.equal(await role(staff),undefined);
  }finally{await db.close();}
});
