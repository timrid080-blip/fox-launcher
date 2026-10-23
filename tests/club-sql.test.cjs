'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const owner='00000000-0000-0000-0000-000000000001',user='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
async function setup(migrate=false){const db=new PGlite();await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(read(migrate?'tests/fixtures/supabase-1.1.sql':'backend/supabase.sql'));
 if(migrate){await db.query(`insert into auth.users values($1,'{"nickname":"FoxBro"}')`,[owner]);await db.query('insert into public.fox_profiles(id,nickname) values($1,$2)',[owner,'FoxBro']);await db.query('insert into public.fox_wallets(id,foxes) values($1,123)',[owner]);await db.exec(read('backend/migrate-1.2.sql'));assert.equal((await db.query('select foxes from public.fox_wallets where id=$1',[owner])).rows[0].foxes,123);}
 await db.query(`insert into auth.users values($1,'{"nickname":"FoxBro"}'),($2,'{"nickname":"Friend"}'),($3,'{"nickname":"OtherFox"}') on conflict do nothing`,[owner,user,other]);
 async function act(id,action,data={}){await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);await db.exec('set role authenticated');try{return(await db.query('select public.fox_action($1,$2) as value',[action,data])).rows[0].value;}finally{await db.exec('reset role');}}
 if(migrate)await db.exec(read('backend/migrate-1.3.sql'));
 for(const id of [owner,user,other])await act(id,'state');await db.query('insert into public.fox_admins values($1)',[owner]);return {db,act};}
for(const migrate of [false,true])test(`Fox Club SQL: ${migrate?'upgrade preserves data':'fresh database'}; rewards, quests, privacy, cases and access`,async()=>{const {db,act}=await setup(migrate);try{
 let s=await act(user,'state');assert.equal(s.club_version,2);assert.equal(s.profile.leaderboard_visible,false);assert.equal(s.daily.claimed,false);assert.equal(s.daily.reward,25);assert.equal(s.quests.length,5);
 // Rewards are UTC/server-side, one claim per calendar day. Rejection rolls back.
 s=await act(user,'daily_claim',{reward:999999,day:'2100-01-01'});assert.equal(s.wallet.foxes,25);assert.equal(s.daily.streak,1);assert.equal(s.daily.claimed,true);
 await assert.rejects(()=>act(user,'daily_claim'),/уже получена/);assert.equal((await act(user,'state')).wallet.foxes,25);
 await db.query("update public.fox_daily_rewards set last_claim=(now() at time zone 'UTC')::date-1,streak=6 where user_id=$1",[user]);
 s=await act(user,'daily_claim');assert.equal(s.daily.streak,7);assert.equal(s.wallet.foxes,80);
 await db.query("update public.fox_daily_rewards set last_claim=(now() at time zone 'UTC')::date-1 where user_id=$1",[user]);s=await act(user,'daily_claim');assert.equal(s.daily.streak,7);assert.equal(s.wallet.foxes,135);
 await db.query("update public.fox_daily_rewards set last_claim=(now() at time zone 'UTC')::date-2 where user_id=$1",[user]);s=await act(user,'state');assert.equal(s.daily.streak,0);assert.equal(s.daily.reward,25);s=await act(user,'daily_claim');assert.equal(s.daily.streak,1);
 await assert.rejects(()=>act(user,'quest_claim',{quest:'play15',progress:999999}),/ещё не выполнен/);
 await assert.rejects(()=>act(user,'quest_claim',{quest:'fake'}),/не найден/);
 await db.query("insert into public.fox_daily_play values($1,(now() at time zone 'UTC')::date,'pack1',900),($1,(now() at time zone 'UTC')::date,'pack2',1)",[user]);
 const before=s.wallet.foxes;s=await act(user,'quest_claim',{quest:'play15'});assert.equal(s.wallet.foxes,before+20);assert.equal(s.quests.find(q=>q.code==='play15').claimed,true);
 await assert.rejects(()=>act(user,'quest_claim',{quest:'play15'}),/уже получена/);s=await act(user,'quest_claim',{quest:'worlds2'});assert.equal(s.wallet.foxes,before+50);
 await db.query("update public.fox_daily_play set day=day-1 where user_id=$1",[user]);s=await act(user,'state');assert.equal(s.quests.find(q=>q.code==='play60').progress,0);
 await db.query("insert into public.fox_progress values($1,'career-pack',36000)",[user]);s=await act(user,'quest_claim',{quest:'journey10'});await assert.rejects(()=>act(user,'quest_claim',{quest:'journey10'}),/уже получена/);
 // Clients cannot publish balances, IDs or email by asking for a different metric.
 let board=await act(user,'leaderboard');assert.equal(board.items.length,0);assert.equal(board.self,null);
 await assert.rejects(()=>act(user,'leaderboard',{metric:'rubles'}),/Неизвестный/);
 await assert.rejects(()=>act(user,'profile_visibility',{visible:'true'}),/видимость/);
 await act(user,'profile_visibility',{visible:true});await act(other,'profile_visibility',{visible:true});board=await act(user,'leaderboard',{metric:'quests'});assert.equal(board.items[0].nickname,'Friend');assert.equal(board.items[0].score,3);assert.equal(board.self.place,1);
 for(const row of board.items){assert.deepEqual(Object.keys(row).sort(),['equipped_cosmetic','nickname','place','score','self']);}
 board=await act(other,'leaderboard',{metric:'pumpkins'});assert.equal(board.items[0].place,1);assert.equal(board.items[1].place,1);
 await act(user,'profile_visibility',{visible:false});board=await act(other,'leaderboard',{metric:'quests'});assert.equal(board.items.some(x=>x.nickname==='Friend'),false);
 // Existing owner checks and wallet invariants stay intact.
 await assert.rejects(()=>act(user,'admin_grant',{user,currency:'foxes',amount:999,reason:'hack'}),/владельцу/);
 await act(owner,'admin_grant',{user,currency:'foxes',amount:1000,reason:'QA reward'});
 await assert.rejects(()=>act(user,'equip',{product:'night-cape'}),/Сначала/);
 const drops=new Set();let balance=(await act(user,'state')).wallet.foxes;
 for(let n=0;n<3;n++){s=await act(user,'buy',{product:'style-case'});assert(s.last_drop);assert(!drops.has(s.last_drop));drops.add(s.last_drop);balance-=90;assert.equal(s.wallet.foxes,balance);s=await act(user,'equip',{product:s.last_drop});assert(drops.has(s.profile.equipped_cosmetic));}
 await assert.rejects(()=>act(user,'buy',{product:'style-case'}),/уже собраны/);assert.equal((await act(user,'state')).wallet.foxes,balance);
 s=await act(user,'equip',{product:''});assert.equal(s.profile.equipped_cosmetic,null);
 await assert.rejects(()=>act(user,'buy',{product:'fox-hat'}),/Уже куплено/);
 // No funds: case must not create even a free cosmetic.
 await assert.rejects(()=>act(other,'buy',{product:'style-case'}),/Недостаточно/);assert.equal((await act(other,'state')).purchases.length,0);
 // Heartbeats count bounded server time and feed daily/career progress.
 const session=await act(other,'start',{instance:'pack'});await db.query("update public.fox_sessions set last_beat=now()-interval '10 minutes' where user_id=$1",[other]);s=await act(other,'beat',{session:session.session,seconds:1000000});assert.equal(s.progress[0].seconds,75);
 const daily=(await db.query('select sum(seconds)::int seconds from public.fox_daily_play where user_id=$1',[other])).rows[0].seconds;assert.equal(daily,75);
 s=await act(other,'end',{session:session.session});await assert.rejects(()=>act(other,'beat',{session:session.session}),/не найдена/);
 // The top is bounded, while a participant outside it still gets their own rank.
 await db.exec(`insert into auth.users select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,jsonb_build_object('nickname','RankFox'||i) from generate_series(1,55) i;
 insert into public.fox_profiles(id,nickname,leaderboard_visible) select id,raw_user_meta_data->>'nickname',true from auth.users where id::text like '10000000-%';
 insert into public.fox_wallets(id,foxes) select id,5000 from public.fox_profiles where id::text like '10000000-%';`);
 board=await act(other,'leaderboard',{metric:'foxes'});assert.equal(board.items.length,50);assert.equal(board.participants,56);assert.equal(board.self.place,56);assert.equal(board.items.some(row=>row.self),false);
 // Denied direct access to wallets, private data and helper functions.
 await db.exec('set role authenticated');
 for(const sql of ["update public.fox_wallets set foxes=999999","select * from public.fox_daily_play","select * from public.fox_quest_claims",`select public.fox_club_state('${other}')`,`select * from public.fox_quest_status('${other}')`])await assert.rejects(()=>db.exec(sql),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query("select public.fox_action('state','{}')"),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}});
