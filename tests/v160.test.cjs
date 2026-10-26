'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('1.6 migration: exact ruble balance is owner-only, audited and not the paid balance',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(read('backend/supabase.sql'));
  await db.exec(read('backend/migrate-1.5.sql'));
  await db.exec(read('backend/migrate-1.6.sql'));
  const owner='00000000-0000-0000-0000-000000000001',user='00000000-0000-0000-0000-000000000002';
  for(const [id,nickname] of [[owner,'Owner'],[user,'Player']]) await db.query('insert into auth.users values($1,$2)',[id,{nickname}]);
  async function act(id,action,data={}){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');try{return (await db.query('select public.fox_action($1,$2) v',[action,data])).rows[0].v;}finally{await db.exec('reset role');}}
  await act(owner,'state');await act(user,'state');await db.query('insert into public.fox_admins values($1)',[owner]);
  await db.query("update public.fox_wallets set rubles=125,paid_kopeks=900 where id=$1",[user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  const result=(await db.query('select public.fox_owner_set_rubles($1,$2,$3) v',[user,800,'Тестовое изменение'])).rows[0].v;
  await db.exec('reset role');
  assert.equal(result.new_amount,800);assert.equal(result.delta,675);
  const wallet=(await db.query('select rubles,paid_kopeks from public.fox_wallets where id=$1',[user])).rows[0];assert.equal(wallet.rubles,800);assert.equal(wallet.paid_kopeks,900);
  const audit=(await db.query("select count(*)::int n from public.fox_staff_audit where action='admin_set_rubles'")).rows[0].n;assert.equal(audit,1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select public.fox_owner_set_rubles($1,$2,$3)',[user,1,'Запрет тест']),/Доступ только владельцу/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await assert.rejects(()=>db.query('select public.fox_owner_set_rubles($1,$2,$3)',[user,-1,'Неверный баланс']),/Баланс должен быть/);
  await db.exec('reset role');
 } finally {await db.close();}
});


test('2.8 owner balance migration permits owner self-credit in rubles and stores kopeks',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(read('backend/supabase.sql'));
  await db.exec(read('backend/migrate-1.5.sql'));
  await db.exec(read('backend/migrate-1.6.sql'));
  await db.exec(read('backend/migrate-2.8-owner-ruble-balance.sql'));
  const owner='00000000-0000-0000-0000-000000000011';
  await db.query('insert into auth.users values($1,$2)',[owner,{nickname:'Owner'}]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.query('select public.fox_action($1,$2)', ['state',{}]);
  await db.query('insert into public.fox_admins values($1)',[owner]);
  await db.exec('set role authenticated');
  const result=(await db.query('select public.fox_owner_set_rubles($1,$2,$3) v',[owner,125,'Проверка своего баланса'])).rows[0].v;
  await db.exec('reset role');
  assert.equal(result.new_amount_kopeks,12500);
  const wallet=(await db.query('select rubles from public.fox_wallets where id=$1',[owner])).rows[0];
  assert.equal(wallet.rubles,12500);
  const audit=(await db.query("select count(*)::int n from public.fox_staff_audit where action='admin_set_rubles'")).rows[0].n;
  assert.equal(audit,1);
 } finally {await db.close();}
});
