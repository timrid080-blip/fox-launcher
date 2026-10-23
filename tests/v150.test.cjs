'use strict';const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('1.5 migration: weekly/daily reset, awards, inbox isolation, moderation, freeze and repeat',async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(read('backend/supabase.sql'));await db.exec(read('backend/migrate-1.5.sql'));await db.exec(read('backend/migrate-1.5.sql'));
 const owner='00000000-0000-0000-0000-000000000001',user='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
 for(const [id,nickname]of [[owner,'Owner'],[user,'Player'],[other,'Other']])await db.query('insert into auth.users values($1,$2)',[id,{nickname}]);
 async function act(id,action,data={}){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');try{return(await db.query('select public.fox_action($1,$2) v',[action,data])).rows[0].v;}finally{await db.exec('reset role');}}
 for(const id of[owner,user,other])await act(id,'state');await db.query('insert into public.fox_admins values($1)',[owner]);
 let s=await act(user,'state');assert.equal(s.features_version,5);assert.equal(s.quests.filter(q=>q.scope==='weekly').length,3);assert.equal(s.quests.filter(q=>q.scope==='daily').length,5);assert.equal(s.catalog.filter(c=>['witch-hat','ghost-friend','bat-wings','jack-lantern'].includes(c.id)).length,4);assert.equal(s.payments_enabled,false);
 await assert.rejects(()=>act(user,'admin_moderate',{user:other,operation:'ban',reason:'test'}),/владельцу/);await assert.rejects(()=>act(owner,'admin_moderate',{user:owner,operation:'ban',reason:'test'}),/владельца/);
 await act(owner,'admin_grant',{user,currency:'foxes',amount:5000,reason:'Подарок от владельца'});let inbox=await act(user,'notifications');assert(inbox.items.some(n=>n.title.includes('5000')));const nid=inbox.items[0].id;assert.equal((await act(other,'notifications')).unread,0);await act(other,'notification_read',{id:nid});assert.equal((await act(user,'notifications')).unread,1);
 await act(user,'notification_read',{all:true});assert.equal((await act(user,'notifications')).unread,0);
 await act(owner,'admin_moderate',{user,operation:'freeze',reason:'Проверка баланса'});await assert.rejects(()=>act(user,'buy',{product:'plus'}),/заморожены/);await act(user,'daily_claim');await act(owner,'admin_moderate',{user,operation:'unfreeze',reason:'Проверка завершена'});
 s=await act(user,'state');assert(!s.moderation.spending_frozen);
 await db.query("insert into public.fox_daily_play values($1,(now() at time zone 'UTC')::date,'pack',10800)",[user]);await db.query("insert into public.fox_progress values($1,'pack',10800)",[user]);
 s=await act(user,'quest_claim',{quest:'week3h'});assert(s.quests.find(q=>q.code==='week3h').claimed);assert(s.achievements.some(a=>a.code==='first30'));const foxes=s.wallet.foxes;await assert.rejects(()=>act(user,'quest_claim',{quest:'week3h'}),/уже получена/);assert.equal((await act(user,'state')).wallet.foxes,foxes);
 // Last week's claim must not block this week; previous day's claim must not block today.
 await db.query("update public.fox_quest_claims set period=period-7 where user_id=$1 and code='week3h'",[user]);s=await act(user,'quest_claim',{quest:'week3h'});assert(s.quests.find(q=>q.code==='week3h').claimed);
 await act(user,'quest_claim',{quest:'play15'});await db.query("update public.fox_quest_claims set period=period-1 where user_id=$1 and code='play15'",[user]);await act(user,'quest_claim',{quest:'play15'});
 // Notification and reward on event tick, using only server-accounted elapsed time.
 await act(owner,'admin_event',{title:'Осень Fox',theme:'halloween',start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),enabled:true});const session=await act(user,'start',{instance:'test'});await db.query("update public.fox_sessions set last_beat=now()-interval '60 seconds',event_seconds=250,event_id=(select id from public.fox_events order by starts_at desc limit 1) where user_id=$1",[user]);await act(user,'beat',{session:session.session});inbox=await act(user,'notifications');assert(inbox.items.some(n=>n.body.includes('5 минут')));
 await act(owner,'admin_moderate',{user,operation:'ban',reason:'Нарушение правил'});await assert.rejects(()=>act(user,'start',{instance:'x'}),/заблокирован/);await assert.rejects(()=>act(user,'daily_claim'),/заблокирован/);s=await act(user,'state');assert(s.moderation.banned);await act(user,'support_create',{title:'Обжалование',body:'Прошу проверить блокировку'});assert((await act(user,'notifications')).items.some(n=>n.kind==='moderation'));
 await act(owner,'admin_moderate',{user,operation:'unban',reason:'Блокировка снята'});assert(!(await act(user,'state')).moderation.banned);await act(user,'start',{instance:'x'});
 await assert.rejects(()=>act(user,'pack_prepare',{}),/экспорт/);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query("select public.fox_action_v140('state')"),/permission denied/);await assert.rejects(()=>db.query('select id from public.fox_notifications'),/permission denied/);await db.exec('reset role');
 assert(!(await act(owner,'state')).moderation.banned);assert((await act(owner,'moderation_users')).length===3);
 assert(!read('backend/migrate-1.5.sql').includes('*'));
 }finally{await db.close();}});
