'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('1.7 migration: adds 2, 3, 6, 12 and 24 month options for all three tiers without changing existing products',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(read('backend/supabase.sql'));
  await db.exec(read('backend/migrate-1.5.sql'));
  await db.exec(read('backend/migrate-1.6.sql'));
  await db.exec(read('backend/migrate-1.7.sql'));
  const rows=(await db.query("select id,tier,days,price,currency,price_kopeks from public.fox_catalog where id like '%-2m' or id like '%-3m' or id like '%-6m' or id like '%-12m' or id like '%-24m' order by tier,days")).rows;
  assert.equal(rows.length,15);
  assert.deepEqual([...new Set(rows.map(r=>Number(r.days)))].sort((a,b)=>a-b),[60,90,180,360,720]);
  assert.equal(rows.filter(r=>Number(r.tier)===1).length,5);
  assert.equal(rows.filter(r=>Number(r.tier)===2).length,5);
  assert.equal(rows.filter(r=>Number(r.tier)===3).length,5);
  assert.ok(rows.every(r=>r.currency==='foxes'&&Number(r.price)>0&&Number(r.price_kopeks)===0));
  const existing=(await db.query("select days,price from public.fox_catalog where id='plus'")).rows[0];
  assert.equal(Number(existing.days),30);assert.equal(Number(existing.price),100);
 } finally {await db.close();}
});
