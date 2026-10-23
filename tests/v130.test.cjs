'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{PGlite}=require('@electric-sql/pglite');
const owner='00000000-0000-0000-0000-000000000001',user='00000000-0000-0000-0000-000000000002';
for(const migrate of [false,true])test('1.3 profiles, discounts and upgrade '+(migrate?'migration':'fresh'),async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 const read=f=>fs.readFileSync(require('path').join(__dirname,'..',f),'utf8');
 if(migrate){await db.exec(read('tests/fixtures/supabase-1.1.sql'));await db.exec(read('backend/migrate-1.2.sql'));await db.exec(read('backend/migrate-1.3.sql'));await db.exec(read('backend/migrate-1.3.sql'));}else await db.exec(read('backend/supabase.sql'));
 await db.query(`insert into auth.users values($1,'{"nickname":"Owner"}'),($2,'{"nickname":"Friend_One"}')`,[owner,user]);
 async function act(id,action,data={}){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');try{return(await db.query('select public.fox_action($1,$2) v',[action,data])).rows[0].v;}finally{await db.exec('reset role');}}
 await act(owner,'state');await act(user,'state');await db.query('insert into public.fox_admins values($1)',[owner]);
 assert.deepEqual(await act(owner,'players'),[]);await assert.rejects(()=>act(owner,'player_profile',{nickname:'Friend_One'}),/скрыт/);
 let s=await act(user,'profile_visibility',{visible:true});const key=s.profile.public_key;assert.notEqual(key,user);
 let list=await act(owner,'players',{search:'Friend_'});assert.equal(list.length,1);assert.deepEqual(Object.keys(list[0]).sort(),['equipped_cosmetic','nickname','public_key']);
 let profile=await act(owner,'player_profile',{key});assert.equal(profile.nickname,'Friend_One');assert.equal(profile.subscription,null);assert(!JSON.stringify(profile).includes(user));assert(!('wallet' in profile));
 await act(user,'profile_visibility',{visible:false});await assert.rejects(()=>act(owner,'player_profile',{key}),/скрыт/);await act(user,'profile_visibility',{visible:true});
 await assert.rejects(()=>act(user,'admin_discount',{product:'pro',percent:90}),/владельцу/);
 for(const [product,percent] of [['pro',91],['upgrade',51],['plus',-1]])await assert.rejects(()=>act(owner,'admin_discount',{product,percent}),/Скидка/);
 await act(owner,'admin_grant',{user,currency:'foxes',amount:10000,reason:'test budget'});
 s=await act(user,'buy',{product:'plus',expected_price:100,price:1});assert.equal(s.wallet.foxes,9900);assert.equal(s.active_subscription.id,'plus');assert.equal(s.quotes.find(q=>q.product==='pro').price,665);
 const expiry=Date.parse(s.active_subscription.expires_at),balance=s.wallet.foxes;
 await assert.rejects(()=>act(user,'buy',{product:'pro',expected_price:1}),/Цена изменилась/);assert.equal((await act(user,'state')).wallet.foxes,balance);
 await act(owner,'admin_discount',{product:'pro',percent:10});s=await act(user,'state');assert.equal(s.quotes.find(q=>q.product==='pro').price,599); // ceil(700*.9*.95)
 s=await act(user,'buy',{product:'pro',expected_price:599});assert.equal(s.wallet.foxes,9301);assert.equal(s.active_subscription.id,'pro');assert.equal(Date.parse(s.active_subscription.expires_at)-expiry,30*86400000);assert.equal(s.purchases.filter(p=>Date.parse(p.expires_at)>Date.now()).length,1);
 profile=await act(owner,'player_profile',{key});assert.equal(profile.subscription.title,'Fox Pro');await assert.rejects(()=>act(user,'buy',{product:'plus'}),/подписка выше/);
 assert.equal(s.quotes.find(q=>q.product==='pro').mode,'renew');assert.equal(s.quotes.find(q=>q.product==='pro').price,630);
 s=await act(user,'buy',{product:'pro',expected_price:630});assert.equal(s.wallet.foxes,8671);assert.equal(Date.parse(s.active_subscription.expires_at)-expiry,60*86400000);
 await act(owner,'admin_discount',{product:'upgrade',percent:0});s=await act(user,'state');assert.equal(s.quotes.find(q=>q.product==='exclusive').price,1500);
 await act(owner,'admin_discount',{product:'fox-hat',percent:50});s=await act(user,'buy',{product:'fox-hat',expected_price:60});assert.equal(s.wallet.foxes,8611);
 await db.query("update public.fox_purchases set expires_at=now()-interval '1 day' where user_id=$1 and expires_at is not null",[user]);s=await act(user,'state');assert.equal(s.active_subscription,null);assert.equal(s.quotes.find(q=>q.product==='plus').mode,'buy');
 await db.exec('set role authenticated');await assert.rejects(()=>db.exec('select * from public.fox_shop_settings'),/permission denied/);await assert.rejects(()=>db.query('select public.fox_subscription_state($1)',[user]),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
