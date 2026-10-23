-- Fox Launcher 1.4.0. Run this WHOLE FILE on Fox Club 1.2 or 1.3.
-- No HTML, Markdown fences or explanatory text belongs in SQL Editor.
begin;
alter table public.fox_catalog add column if not exists discount_percent integer not null default 0 check(discount_percent between 0 and 90);
alter table public.fox_profiles add column if not exists public_key uuid not null default gen_random_uuid() unique;
create table if not exists public.fox_shop_settings(id integer primary key check(id=1), upgrade_discount integer not null default 5 check(upgrade_discount between 0 and 50));
insert into public.fox_shop_settings(id) values(1) on conflict do nothing;
alter table public.fox_shop_settings enable row level security;
revoke all on public.fox_shop_settings from public,anon,authenticated;
create or replace function public.fox_subscription_state(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with active as (
 select c.id,c.title,c.tier,max(p.expires_at) expires_at from public.fox_purchases p join public.fox_catalog c on c.id=p.product_id
 where p.user_id=p_user and c.kind='subscription' and p.expires_at>now() group by c.id,c.title,c.tier order by c.tier desc,expires_at desc limit 1
 ), setting as (select upgrade_discount from public.fox_shop_settings where id=1)
 select jsonb_build_object('shop_version',3,'active_subscription',(select to_jsonb(a) from active a),'upgrade_discount',(select upgrade_discount from setting),
 'quotes',(select coalesce(jsonb_agg(jsonb_build_object('product',c.id,'price',greatest(1,ceil(pg_catalog.numeric_mul(pg_catalog.numeric_mul(c.price::numeric,100-c.discount_percent)/100,(case when c.kind='subscription' and c.tier>coalesce((select tier from active),0) and exists(select 1 from active) then 100-(select upgrade_discount from setting) else 100 end))/100)),
 'mode',case when c.kind<>'subscription' then 'buy' when not exists(select 1 from active) then 'buy' when c.tier<(select tier from active) then 'blocked' when c.tier=(select tier from active) then 'renew' else 'upgrade' end)),'[]'::jsonb) from public.fox_catalog c where c.enabled));
$$;
revoke all on function public.fox_subscription_state(uuid) from public,anon,authenticated;
create or replace function public.fox_action_v130(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid := auth.uid(); adm boolean; w public.fox_wallets; c public.fox_catalog; ev public.fox_events; se public.fox_sessions; target uuid; n bigint; elapsed bigint; total_time bigint; max_time bigint; expires timestamptz; old_exp timestamptz; old_coins bigint; fresh boolean; sid uuid; result jsonb; nick text; today date := (now() at time zone 'UTC')::date; day_seconds bigint; daily_row public.fox_daily_rewards; quest record; period_day date; metric_name text; drop_id text; quote jsonb; active_sub jsonb; charge bigint;
begin
 if u is null then raise exception 'Требуется вход в аккаунт Fox'; end if;
 select exists(select 1 from public.fox_admins where id=u) into adm;
 if not exists(select 1 from public.fox_profiles where id=u) then
  select raw_user_meta_data->>'nickname' into nick from auth.users where id=u;
  if nick is null or nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Ник: 3–16 латинских букв, цифр или _'; end if;
  insert into public.fox_profiles(id,nickname) values(u,nick) on conflict do nothing;
 end if;
 insert into public.fox_wallets(id) values(u) on conflict do nothing;
 select "id","foxes","pumpkins","rubles","paid_kopeks" into w from public.fox_wallets where id=u for update;
 select "id","title","theme","starts_at","ends_at","enabled" into ev from public.fox_events where enabled and starts_at<=now() and ends_at>now() order by starts_at desc limit 1;
 if p_action='start' then
  if length(coalesce(p_data->>'instance','')) not between 1 and 160 then raise exception 'Неверная сборка'; end if;
  insert into public.fox_sessions(user_id,instance_id) values(u,p_data->>'instance') on conflict(user_id) do update set id=gen_random_uuid(),instance_id=excluded.instance_id,last_beat=now(),event_seconds=0,event_id=null returning id into sid;
  return jsonb_build_object('session',sid);
 elsif p_action in ('beat','end') then
  select "user_id","id","instance_id","last_beat","event_seconds","event_id" into se from public.fox_sessions where user_id=u and id=(p_data->>'session')::uuid for update;
  if not found then raise exception 'Игровая сессия не найдена'; end if;
  elapsed:=least(75,greatest(0,floor(extract(epoch from now()-se.last_beat))::bigint));
  insert into public.fox_progress(user_id,instance_id,seconds) values(u,se.instance_id,elapsed) on conflict(user_id,instance_id) do update set seconds=public.fox_progress.seconds+excluded.seconds;
  -- Split the bounded heartbeat at UTC midnight; clients never supply time or rewards.
  day_seconds:=least(elapsed,greatest(0,floor(extract(epoch from now()-(today::timestamp at time zone 'UTC')))::bigint));
  insert into public.fox_daily_play(user_id,day,instance_id,seconds) values(u,today,se.instance_id,day_seconds) on conflict(user_id,day,instance_id) do update set seconds=public.fox_daily_play.seconds+excluded.seconds;
  if elapsed>day_seconds then
   insert into public.fox_daily_play(user_id,day,instance_id,seconds) values(u,today-1,se.instance_id,elapsed-day_seconds) on conflict(user_id,day,instance_id) do update set seconds=public.fox_daily_play.seconds+excluded.seconds;
  end if;
  if ev.id is not null then
   -- Credit only overlap with event, not the minutes before its start.
   n:=least(elapsed,greatest(0,floor(extract(epoch from now()-greatest(ev.starts_at,se.last_beat)))::bigint));
   old_coins:=case when se.event_id=ev.id then se.event_seconds else 0 end;
   update public.fox_wallets set pumpkins=pumpkins+((old_coins+n)/300-old_coins/300) where id=u;
   update public.fox_sessions set event_id=ev.id,event_seconds=old_coins+n where user_id=u;
  end if;
  update public.fox_sessions set last_beat=now() where user_id=u;
  select coalesce(sum(seconds),0),coalesce(max(seconds),0) into total_time,max_time from public.fox_progress where user_id=u;
  if total_time>=3600 then
   insert into public.fox_achievements(user_id,code) values(u,'gamer') on conflict do nothing; fresh:=found;
   if fresh then update public.fox_wallets set foxes=foxes+100 where id=u; insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'foxes',100,'achievement:gamer'); end if;
  end if;
  if max_time>=36000 then
   insert into public.fox_achievements(user_id,code) values(u,'addict') on conflict do nothing; fresh:=found;
   if fresh then update public.fox_wallets set foxes=foxes+500 where id=u; insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'foxes',500,'achievement:addict'); end if;
  end if;
  if p_action='end' then delete from public.fox_sessions where user_id=u; end if;
 elsif p_action='daily_claim' then
  select "user_id","last_claim","streak" into daily_row from public.fox_daily_rewards where user_id=u;
  if daily_row.last_claim=today then raise exception 'Ежедневная награда уже получена. Новый день — в 00:00 UTC'; end if;
  n:=case when daily_row.last_claim=today-1 then least(7,daily_row.streak+1) else 1 end;
  insert into public.fox_daily_rewards(user_id,last_claim,streak) values(u,today,n) on conflict(user_id) do update set last_claim=excluded.last_claim,streak=excluded.streak;
  n:=25+pg_catalog.int8mul(5,n-1);
  update public.fox_wallets set foxes=foxes+n where id=u;
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'foxes',n,'daily:'||today);
 elsif p_action='quest_claim' then
  select code,title,scope,metric,goal,reward,progress,claimed into quest from public.fox_quest_status(u) where code=p_data->>'quest';
  if not found then raise exception 'Квест не найден'; end if;
  if quest.claimed then raise exception 'Награда за квест уже получена'; end if;
  if quest.progress<quest.goal then raise exception 'Квест ещё не выполнен'; end if;
  period_day:=case when quest.scope='daily' then today else date '1970-01-01' end;
  insert into public.fox_quest_claims(user_id,code,period) values(u,quest.code,period_day);
  update public.fox_wallets set foxes=foxes+quest.reward where id=u;
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'foxes',quest.reward,'quest:'||quest.code||':'||period_day);
 elsif p_action='profile_visibility' then
  if jsonb_typeof(p_data->'visible') is distinct from 'boolean' then raise exception 'Укажи видимость профиля'; end if;
  update public.fox_profiles set leaderboard_visible=(p_data->>'visible')::boolean where id=u;
 elsif p_action='equip' then
  drop_id:=nullif(p_data->>'product','');
  if drop_id is not null and not exists(select 1 from public.fox_purchases p join public.fox_catalog itemcat on itemcat.id=p.product_id where p.user_id=u and p.product_id=drop_id and itemcat.kind='cosmetic') then raise exception 'Сначала получи аксессуар'; end if;
  update public.fox_profiles set equipped_cosmetic=drop_id where id=u;
 elsif p_action='leaderboard' then
  metric_name:=coalesce(p_data->>'metric','playtime');
  if metric_name not in ('playtime','quests','foxes','pumpkins') then raise exception 'Неизвестный рейтинг'; end if;
  with scores as (
   select p.id,p.nickname,p.equipped_cosmetic,
   case metric_name when 'playtime' then (select coalesce(sum(seconds),0)::bigint from public.fox_progress where user_id=p.id)
    when 'quests' then (select count(1) from public.fox_quest_claims where user_id=p.id)
    when 'foxes' then wr.foxes else wr.pumpkins end score
   from public.fox_profiles p join public.fox_wallets wr on wr.id=p.id where p.leaderboard_visible and p.stats_visibility='all'
  ), ranked as (select id,nickname,equipped_cosmetic,score,rank() over(order by score desc) place from scores)
  select jsonb_build_object('metric',metric_name,'participants',(select count(1) from ranked),
   'items',(select coalesce(jsonb_agg(to_jsonb(t) order by t.score desc,t.nickname,t.sort_id),'[]'::jsonb) from (select place,nickname,score,equipped_cosmetic,id=u self,id sort_id from ranked order by score desc,nickname,id limit 50) t),
   'self',(select jsonb_build_object('place',place,'nickname',nickname,'score',score) from ranked where id=u)) into result;
  -- Do not publish Auth UUIDs, email addresses, ruble balances or transaction logs.
  result:=jsonb_set(result,'{items}',(select coalesce(jsonb_agg(item-'sort_id'),'[]'::jsonb) from jsonb_array_elements(result->'items') item));
  return result;
 elsif p_action='players' then
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (
   select public_key,nickname,equipped_cosmetic from public.fox_profiles where leaderboard_visible
   and nickname ilike replace(replace(left(coalesce(p_data->>'search',''),16),'%','\%'),'_','\_')||'%' order by lower(nickname),public_key limit 50) q);
 elsif p_action='player_profile' then
  if nullif(p_data->>'key','') is not null then
   select id into target from public.fox_profiles where public_key=(p_data->>'key')::uuid and (leaderboard_visible or id=u);
  else
   if (select count(1) from public.fox_profiles where lower(nickname)=lower(p_data->>'nickname') and (leaderboard_visible or id=u))>1 then raise exception 'Найдено несколько игроков. Открой профиль через поиск игроков'; end if;
   select id into target from public.fox_profiles where lower(nickname)=lower(p_data->>'nickname') and (leaderboard_visible or id=u);
  end if;
  if target is null then raise exception 'Профиль скрыт или не найден'; end if;
  return jsonb_build_object('nickname',(select nickname from public.fox_profiles where id=target),'created_at',(select created_at from public.fox_profiles where id=target),
   'equipped_cosmetic',(select equipped_cosmetic from public.fox_profiles where id=target),
   'seconds',(select coalesce(sum(seconds),0) from public.fox_progress where user_id=target),
   'quests',(select count(1) from public.fox_quest_claims where user_id=target),
   'achievements',(select coalesce(jsonb_agg(code),'[]'::jsonb) from public.fox_achievements where user_id=target),
   'subscription',(select public.fox_subscription_state(target)->'active_subscription'));
 elsif p_action='admin_discount' then
  if not adm then raise exception 'Доступ только владельцу'; end if;
  n:=(p_data->>'percent')::integer;
  if n is null then raise exception 'Укажи скидку'; end if;
  if p_data->>'product'='upgrade' then
   if n not between 0 and 50 then raise exception 'Скидка апгрейда: 0–50%%'; end if;
   update public.fox_shop_settings set upgrade_discount=n where id=1;
  else
   if n not between 0 and 90 then raise exception 'Скидка товара: 0–90%%'; end if;
   update public.fox_catalog set discount_percent=n where id=p_data->>'product';
   if not found then raise exception 'Товар не найден'; end if;
  end if;
  insert into public.fox_ledger(user_id,actor,currency,amount,reason) values(u,u,'foxes',0,'discount:'||(p_data->>'product')||':'||n);
 elsif p_action='buy' then
  select "id","title","description","kind","price","currency","tier","days","event_only","reward_currency","reward_amount","enabled","discount_percent","price_kopeks" into c from public.fox_catalog where id=p_data->>'product' and enabled;
  if not found then raise exception 'Товар недоступен'; end if;
  active_sub:=public.fox_subscription_state(u)->'active_subscription';
  select item into quote from jsonb_array_elements(public.fox_subscription_state(u)->'quotes') item where item->>'product'=c.id;
  if quote->>'mode'='blocked' then raise exception 'У тебя уже подписка выше. Дождись окончания или улучши её'; end if;
  charge:=(quote->>'price')::bigint;
  if p_data ? 'expected_price' and (p_data->>'expected_price')::bigint<>charge then raise exception 'Цена изменилась. Обнови магазин и подтверди покупку заново'; end if;
  if c.kind='case' then
   if c.id<>'style-case' then raise exception 'Кейс недоступен'; end if;
   select cat.id into drop_id from public.fox_catalog cat where cat.id in ('fox-hat','night-cape','star-art') and cat.enabled and not exists(select 1 from public.fox_purchases p where p.user_id=u and p.product_id=cat.id) order by random() limit 1;
   if drop_id is null then raise exception 'Все аксессуары кейса уже собраны. Фоксы не списаны'; end if;
  end if;
  if c.event_only and ev.id is null then raise exception 'Сейчас нет активного ивента'; end if;
  if c.kind='cosmetic' and exists(select 1 from public.fox_purchases where user_id=u and product_id=c.id) then raise exception 'Уже куплено'; end if;
  if (case c.currency when 'foxes' then w.foxes when 'pumpkins' then w.pumpkins else w.rubles end)<charge then raise exception 'Недостаточно средств'; end if;
  update public.fox_wallets set foxes=foxes-case when c.currency='foxes' then charge else 0 end,pumpkins=pumpkins-case when c.currency='pumpkins' then charge else 0 end,rubles=rubles-case when c.currency='rubles' then charge else 0 end where id=u;
  if c.kind='exchange' then
   update public.fox_wallets set foxes=foxes+case when c.reward_currency='foxes' then c.reward_amount else 0 end,pumpkins=pumpkins+case when c.reward_currency='pumpkins' then c.reward_amount else 0 end where id=u;
   insert into public.fox_ledger(user_id,currency,amount,reason) values(u,c.reward_currency,c.reward_amount,'exchange:'||c.id);
  end if;
  if c.kind='subscription' then
   select max(p.expires_at) into old_exp from public.fox_purchases p join public.fox_catalog cat on cat.id=p.product_id where p.user_id=u and cat.kind='subscription' and p.expires_at>now();
   expires:=greatest(now(),coalesce(old_exp,now()))+make_interval(days=>c.days);
   update public.fox_purchases p set expires_at=now() from public.fox_catalog cat where cat.id=p.product_id and cat.kind='subscription' and p.user_id=u and p.expires_at>now();
  end if;
  insert into public.fox_purchases(user_id,product_id,expires_at) values(u,c.id,expires);
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,c.currency,-charge,'purchase:'||c.id);
  if c.kind='case' then insert into public.fox_purchases(user_id,product_id) values(u,drop_id); result:=jsonb_build_object('last_drop',drop_id); end if;
 elsif p_action='admin_grant' then
  if not adm then raise exception 'Доступ только владельцу'; end if;
  target:=(p_data->>'user')::uuid;n:=(p_data->>'amount')::bigint;
  if n not between 1 and 1000000 or p_data->>'currency' not in ('foxes','pumpkins','rubles') or length(coalesce(p_data->>'reason','')) not between 3 and 200 then raise exception 'Проверь валюту, сумму и причину'; end if;
  if not exists(select 1 from public.fox_profiles where id=target) then raise exception 'Пользователь ещё не вошёл в Fox Launcher'; end if;
  update public.fox_wallets set foxes=foxes+case when p_data->>'currency'='foxes' then n else 0 end,pumpkins=pumpkins+case when p_data->>'currency'='pumpkins' then n else 0 end,rubles=rubles+case when p_data->>'currency'='rubles' then n else 0 end where id=target;
  insert into public.fox_ledger(user_id,actor,currency,amount,reason) values(target,u,p_data->>'currency',n,p_data->>'reason');
 elsif p_action='admin_event' then
  if not adm then raise exception 'Доступ только владельцу'; end if;
  insert into public.fox_events(id,title,theme,starts_at,ends_at,enabled) values(coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid()),p_data->>'title',p_data->>'theme',(p_data->>'start')::timestamptz,(p_data->>'end')::timestamptz,coalesce((p_data->>'enabled')::boolean,true)) on conflict(id) do update set title=excluded.title,theme=excluded.theme,starts_at=excluded.starts_at,ends_at=excluded.ends_at,enabled=excluded.enabled;
 elsif p_action='admin_users' then
  if not adm then raise exception 'Доступ только владельцу'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select p.id,p.nickname,wr.foxes,wr.pumpkins,wr.rubles from public.fox_profiles p join public.fox_wallets wr on wr.id=p.id order by p.created_at desc limit 500) q);
 elsif p_action<>'state' then raise exception 'Неизвестная операция';
 end if;
 return jsonb_build_object('profile',(select to_jsonb(p) from public.fox_profiles p where p.id=u),'is_admin',adm,'wallet',(select to_jsonb(wr) from public.fox_wallets wr where wr.id=u),'catalog',(select coalesce(jsonb_agg(to_jsonb(catrow)),'[]'::jsonb) from public.fox_catalog catrow where enabled),'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.fox_events e where (enabled or adm) and (ends_at>now() or adm)),'purchases',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.fox_purchases p where user_id=u),'achievements',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.fox_achievements a where user_id=u),'progress',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.fox_progress p where user_id=u),'ledger',(select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select currency,amount,reason,created_at from public.fox_ledger where user_id=u order by created_at desc limit 30) q)) || public.fox_club_state(u) || public.fox_subscription_state(u) || coalesce(result,'{}'::jsonb);
end; $$;

revoke all on function public.fox_action_v130(text,jsonb) from public,anon,authenticated;
alter table public.fox_wallets add column if not exists paid_kopeks bigint not null default 0 check(paid_kopeks>=0);
alter table public.fox_catalog add column if not exists price_kopeks bigint not null default 0 check(price_kopeks>=0 and price_kopeks<=100000000);
alter table public.fox_profiles add column if not exists about text not null default '' check(length(about)<=160);
alter table public.fox_profiles add column if not exists stats_visibility text not null default 'all' check(stats_visibility in ('all','friends','me'));
alter table public.fox_profiles add column if not exists friends_visibility text not null default 'me' check(friends_visibility in ('all','friends','me'));
alter table public.fox_profiles add column if not exists allow_requests boolean not null default true;
create table if not exists public.fox_roles(user_id uuid not null references auth.users on delete cascade,role text not null check(role in ('support','support_lead','developer','media','media_manager','moderator')),primary key(user_id,role));
create table if not exists public.fox_friends(id uuid primary key default gen_random_uuid(),sender uuid not null references auth.users on delete cascade,recipient uuid not null references auth.users on delete cascade,status text not null default 'pending' check(status in ('pending','accepted')),created_at timestamptz not null default now(),check(sender<>recipient));
create unique index if not exists fox_friend_pair on public.fox_friends(least(sender,recipient),greatest(sender,recipient));
create table if not exists public.fox_tickets(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,title text not null check(length(title) between 3 and 100),status text not null default 'open' check(status in ('open','closed')),assigned uuid references auth.users on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.fox_ticket_messages(id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.fox_tickets on delete cascade,user_id uuid not null references auth.users on delete cascade,body text not null check(length(body) between 1 and 4000),created_at timestamptz not null default now());
create table if not exists public.fox_staff_audit(id uuid primary key default gen_random_uuid(),actor uuid not null references auth.users,action text not null,data jsonb not null,created_at timestamptz not null default now());
create table if not exists public.fox_payment_settings(id int primary key check(id=1),enabled boolean not null default false);
insert into public.fox_payment_settings(id) values(1) on conflict do nothing;
create table if not exists public.fox_payment_orders(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,request_id uuid not null,amount_kopeks bigint not null check(amount_kopeks between 10000 and 1500000),status text not null default 'pending' check(status in ('pending','succeeded','canceled')),provider_id uuid unique,created_at timestamptz not null default now(),paid_at timestamptz,unique(user_id,request_id));
create table if not exists public.fox_purchase_requests(user_id uuid not null references auth.users on delete cascade,request_id uuid not null,product_id text not null,amount_kopeks bigint not null,created_at timestamptz not null default now(),primary key(user_id,request_id));
create table if not exists public.fox_pack_shares(id uuid primary key default gen_random_uuid(),sender uuid not null references auth.users on delete cascade,recipient uuid not null references auth.users on delete cascade,title text not null check(length(title) between 1 and 80),object_path text unique not null,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),size_bytes bigint not null check(size_bytes between 1 and 50331648),status text not null default 'uploading' check(status in ('uploading','ready')),created_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['fox_purchase_requests','fox_roles','fox_friends','fox_tickets','fox_ticket_messages','fox_staff_audit','fox_payment_settings','fox_payment_orders','fox_pack_shares'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);end loop;end; $$;
create or replace function public.fox_are_friends(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.fox_friends where status='accepted' and least(sender,recipient)=least(a,b) and greatest(sender,recipient)=greatest(a,b))$$;
revoke all on function public.fox_are_friends(uuid,uuid) from public,anon,authenticated;
create or replace function public.fox_social_state(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
with xp as (select (coalesce((select floor(sum(seconds)/60) from public.fox_progress where user_id=p_user),0)+(select pg_catalog.int8mul(count(1),50) from public.fox_quest_claims where user_id=p_user))::bigint value)
select jsonb_build_object('system_version',4,'roles',(select coalesce(jsonb_agg(role),'[]'::jsonb) from (select role from public.fox_roles where user_id=p_user union all select 'owner' where exists(select 1 from public.fox_admins where id=p_user)) r),
'can_support',exists(select 1 from public.fox_roles where user_id=p_user and role in ('support','support_lead')) or exists(select 1 from public.fox_admins where id=p_user),
'level',(select jsonb_build_object('xp',value,'level',1+value/300,'progress',value%300,'next',300) from xp),
'friends_count',(select count(1) from public.fox_friends where status='accepted' and p_user in (sender,recipient)),
'friend_requests',(select count(1) from public.fox_friends where status='pending' and recipient=p_user),
'payments_enabled',(select enabled from public.fox_payment_settings where id=1),
'quotes_rub',(select coalesce(jsonb_agg(jsonb_build_object('product',c.id,'price',greatest(1,ceil(pg_catalog.numeric_mul(pg_catalog.numeric_mul(c.price_kopeks::numeric,100-c.discount_percent)/100,(case when q.item->>'mode'='upgrade' then 100-(select upgrade_discount from public.fox_shop_settings where id=1) else 100 end))/100)),'mode',q.item->>'mode')),'[]'::jsonb) from public.fox_catalog c cross join lateral jsonb_array_elements(public.fox_subscription_state(p_user)->'quotes') q(item) where c.id=q.item->>'product' and c.kind='subscription' and c.enabled and c.price_kopeks>0));
$$;
revoke all on function public.fox_social_state(uuid) from public,anon,authenticated;
create or replace function public.fox_storage_allowed(p_path text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.fox_pack_shares s where s.object_path=p_path and ((p_write and s.sender=auth.uid()) or (not p_write and (s.sender=auth.uid() or (s.recipient=auth.uid() and s.status='ready' and public.fox_are_friends(s.sender,s.recipient))))));
$$;
revoke all on function public.fox_storage_allowed(text,boolean) from public,anon;
grant execute on function public.fox_storage_allowed(text,boolean) to authenticated;
-- Supabase Storage exists in production; this block is skipped by local SQL-only tests.
do $$begin if to_regclass('storage.buckets') is not null then
 execute $s$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fox-packs','fox-packs',false,50331648,array['application/octet-stream']) on conflict(id) do update set public=false,file_size_limit=50331648,allowed_mime_types=array['application/octet-stream']$s$;
 execute 'drop policy if exists fox_pack_insert on storage.objects';
 execute 'create policy fox_pack_insert on storage.objects for insert to authenticated with check(bucket_id=''fox-packs'' and public.fox_storage_allowed(name,true))';
 execute 'drop policy if exists fox_pack_delete on storage.objects';
 execute 'create policy fox_pack_delete on storage.objects for delete to authenticated using(bucket_id=''fox-packs'' and public.fox_storage_allowed(name,true))';
 execute 'drop policy if exists fox_pack_read on storage.objects';
 execute 'create policy fox_pack_read on storage.objects for select to authenticated using(bucket_id=''fox-packs'' and public.fox_storage_allowed(name,false))';
end if;end; $$;
create or replace function public.fox_action(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();adm boolean;staff boolean; b jsonb;outcome jsonb;target uuid;rec record;tid uuid;sid uuid;key_id uuid;charge bigint;expiry timestamptz;cat public.fox_catalog;quote jsonb;can_stats boolean;role_name text;num bigint;nonce uuid;
begin
 if u is null then raise exception 'Требуется вход в Fox ID';end if;
 -- Initialize profile and lock the wallet, including for friends/role changes.
 b:=public.fox_action_v130('state');adm:=(b->>'is_admin')::boolean;
 staff:=adm or exists(select 1 from public.fox_roles where user_id=u and role in ('support','support_lead'));
 if p_action='profile_settings' then
  if p_data->>'stats' not in ('all','friends','me') or p_data->>'friends' not in ('all','friends','me') or jsonb_typeof(p_data->'requests') is distinct from 'boolean' or length(coalesce(p_data->>'about',''))>160 then raise exception 'Проверь настройки профиля';end if;
  update public.fox_profiles set about=coalesce(p_data->>'about',''),stats_visibility=p_data->>'stats',friends_visibility=p_data->>'friends',allow_requests=(p_data->>'requests')::boolean where id=u;
 elsif p_action='player_profile' then
  if nullif(p_data->>'key','') is not null then select id into target from public.fox_profiles where public_key=(p_data->>'key')::uuid;
  else
   if (select count(1) from public.fox_profiles where lower(nickname)=lower(p_data->>'nickname') and (leaderboard_visible or id=u or public.fox_are_friends(u,id)))>1 then raise exception 'Несколько игроков: открой через поиск';end if;
   select id into target from public.fox_profiles where lower(nickname)=lower(p_data->>'nickname') and (leaderboard_visible or id=u or public.fox_are_friends(u,id));
  end if;
  select "id","nickname","created_at","leaderboard_visible","equipped_cosmetic","public_key","about","stats_visibility","friends_visibility","allow_requests" into rec from public.fox_profiles where id=target;
  if target is null or not (rec.leaderboard_visible or target=u or public.fox_are_friends(u,target)) then raise exception 'Профиль скрыт или не найден';end if;
  can_stats:=target=u or rec.stats_visibility='all' or (rec.stats_visibility='friends' and public.fox_are_friends(u,target));
  return jsonb_build_object('public_key',rec.public_key,'nickname',rec.nickname,'about',rec.about,'created_at',rec.created_at,'equipped_cosmetic',rec.equipped_cosmetic,'self',target=u,
  'roles',public.fox_social_state(target)->'roles','level',case when can_stats then public.fox_social_state(target)->'level' else null end,
  'seconds',case when can_stats then (select coalesce(sum(seconds),0) from public.fox_progress where user_id=target) else null end,
  'quests',case when can_stats then (select count(1) from public.fox_quest_claims where user_id=target) else null end,
  'achievements',case when can_stats then (select coalesce(jsonb_agg(code),'[]'::jsonb) from public.fox_achievements where user_id=target) else '[]'::jsonb end,
  'stats_hidden',not can_stats,'subscription',case when can_stats then public.fox_subscription_state(target)->'active_subscription' else null end,
  'friends',case when target=u or rec.friends_visibility='all' or (rec.friends_visibility='friends' and public.fox_are_friends(u,target)) then
  (select coalesce(jsonb_agg(jsonb_build_object('public_key',p.public_key,'nickname',p.nickname)),'[]'::jsonb) from public.fox_friends f join public.fox_profiles p on p.id=case when f.sender=target then f.recipient else f.sender end where f.status='accepted' and target in (f.sender,f.recipient)) else null end);
 elsif p_action='friends' then
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select f.id,f.status,f.sender=u outgoing,p.public_key,p.nickname,p.equipped_cosmetic from public.fox_friends f join public.fox_profiles p on p.id=case when f.sender=u then f.recipient else f.sender end where u in (f.sender,f.recipient) order by f.created_at desc limit 200) q);
 elsif p_action='friend_request' then
  select id into target from public.fox_profiles where public_key=(p_data->>'key')::uuid and leaderboard_visible and allow_requests;
  if target is null or target=u then raise exception 'Игрок недоступен для заявки';end if;
  if (select count(1) from public.fox_friends where u in (sender,recipient))>=200 then raise exception 'Лимит: 200 друзей и заявок';end if;
  insert into public.fox_friends(sender,recipient) values(u,target) on conflict do nothing;
 elsif p_action in ('friend_accept','friend_remove') then
  select "id","sender","recipient","status","created_at" into rec from public.fox_friends where id=(p_data->>'id')::uuid and u in (sender,recipient) for update;
  if not found then raise exception 'Заявка не найдена';end if;
  if p_action='friend_accept' then
   if rec.recipient<>u or rec.status<>'pending' then raise exception 'Принять может только получатель заявки';end if;
   update public.fox_friends set status='accepted' where id=rec.id;
  else delete from public.fox_friends where id=rec.id;end if;
 elsif p_action='admin_role' then
  if not adm then raise exception 'Только владелец выдаёт роли';end if;
  target:=(p_data->>'user')::uuid;role_name:=p_data->>'role';
  if role_name not in ('support','support_lead','developer','media','media_manager','moderator') or role_name is null or jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Недопустимая роль';end if;
  if not exists(select 1 from public.fox_profiles where id=target) then raise exception 'Игрок не найден';end if;
  if (p_data->>'enabled')::boolean then insert into public.fox_roles values(target,role_name) on conflict do nothing;else delete from public.fox_roles where user_id=target and role=role_name;end if;
  insert into public.fox_staff_audit(actor,action,data) values(u,'role',p_data);
 elsif p_action='staff_users' then
  if not adm then raise exception 'Только владелец';end if;
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select p.id,p.nickname,public.fox_social_state(p.id)->'roles' roles from public.fox_profiles p order by p.created_at desc limit 500) q);
 elsif p_action='support_create' then
  if length(trim(coalesce(p_data->>'title',''))) not between 3 and 100 or length(trim(coalesce(p_data->>'body',''))) not between 1 and 4000 then raise exception 'Тема: 3–100 символов, сообщение: 1–4000';end if;
  if (select count(1) from public.fox_tickets where user_id=u and status='open')>=10 then raise exception 'Лимит: 10 открытых обращений';end if;
  insert into public.fox_tickets(user_id,title) values(u,trim(p_data->>'title')) returning id into tid;
  insert into public.fox_ticket_messages(ticket_id,user_id,body) values(tid,u,trim(p_data->>'body'));
 elsif p_action='support_list' then
  if coalesce((p_data->>'work')::boolean,false) and not staff then raise exception 'Нет доступа к работе поддержки';end if;
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select t.id,t.title,t.status,t.created_at,t.updated_at,p.nickname,ap.nickname assigned from public.fox_tickets t join public.fox_profiles p on p.id=t.user_id left join public.fox_profiles ap on ap.id=t.assigned where (coalesce((p_data->>'work')::boolean,false) and staff) or t.user_id=u order by t.updated_at desc limit 100) q);
 elsif p_action in ('support_get','support_reply','support_close','support_assign') then
  select "id","user_id","title","status","assigned","created_at","updated_at" into rec from public.fox_tickets where id=(p_data->>'id')::uuid and (user_id=u or staff) for update;
  if not found then raise exception 'Обращение не найдено';end if;
  if p_action='support_reply' then
   if rec.status<>'open' then raise exception 'Обращение закрыто';end if;
   if length(trim(coalesce(p_data->>'body',''))) not between 1 and 4000 then raise exception 'Сообщение: 1–4000 символов';end if;
   if (select count(1) from public.fox_ticket_messages where ticket_id=rec.id)>=200 then raise exception 'Лимит сообщений, создай новое обращение';end if;
   insert into public.fox_ticket_messages(ticket_id,user_id,body) values(rec.id,u,trim(p_data->>'body'));
   update public.fox_tickets set updated_at=now() where id=rec.id;
  elsif p_action='support_close' then update public.fox_tickets set status='closed',updated_at=now() where id=rec.id;
  elsif p_action='support_assign' then
   if not staff then raise exception 'Только поддержка';end if;
   if rec.status<>'open' then raise exception 'Обращение закрыто';end if;
   update public.fox_tickets set assigned=u,updated_at=now() where id=rec.id;
  end if;
  return jsonb_build_object('ticket',(select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'assigned',p.nickname) from public.fox_tickets t left join public.fox_profiles p on p.id=t.assigned where t.id=rec.id),
  'messages',(select coalesce(jsonb_agg(jsonb_build_object('nickname',p.nickname,'body',m.body,'created_at',m.created_at,'staff',exists(select 1 from public.fox_admins where id=m.user_id) or exists(select 1 from public.fox_roles where user_id=m.user_id and role in ('support','support_lead'))) order by m.created_at,m.id),'[]'::jsonb) from public.fox_ticket_messages m join public.fox_profiles p on p.id=m.user_id where m.ticket_id=rec.id));
 elsif p_action='admin_ruble_price' then
  if not adm then raise exception 'Только владелец';end if;
  num:=(p_data->>'kopeks')::bigint;
  if num is null or num<0 or num>100000000 then raise exception 'Некорректная цена';end if;
  update public.fox_catalog set price_kopeks=num where id=p_data->>'product' and kind='subscription';if not found then raise exception 'Подписка не найдена';end if;
  insert into public.fox_staff_audit(actor,action,data) values(u,'ruble_price',p_data);
 elsif p_action='admin_payments' then
  if not adm then raise exception 'Только владелец';end if;
  if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Укажи состояние оплаты';end if;
  update public.fox_payment_settings set enabled=(p_data->>'enabled')::boolean where id=1;
  insert into public.fox_staff_audit(actor,action,data) values(u,'payments',p_data);
 elsif p_action='payment_order' then
  if not (select enabled from public.fox_payment_settings where id=1) then raise exception 'Оплата ещё не подключена владельцем';end if;
  num:=(p_data->>'amount')::bigint;nonce:=(p_data->>'request_id')::uuid;
  if num is null or num not between 100 and 15000 or nonce is null then raise exception 'Сумма: от 100 до 15000 рублей';end if;
  select "id","user_id","request_id","amount_kopeks","status","provider_id","created_at","paid_at" into rec from public.fox_payment_orders where user_id=u and request_id=nonce;
  if found then return jsonb_build_object('id',rec.id,'amount_kopeks',rec.amount_kopeks,'status',rec.status);end if;
  if (select count(1) from public.fox_payment_orders where user_id=u and created_at>now()-interval '1 day')>=20 then raise exception 'Лимит: 20 запросов оплаты в день';end if;
  insert into public.fox_payment_orders(user_id,request_id,amount_kopeks) values(u,nonce,pg_catalog.int8mul(num,100)) returning id into tid;
  return jsonb_build_object('id',tid,'amount_kopeks',pg_catalog.int8mul(num,100),'status','pending');
 elsif p_action='payment_status' then
  select "id","user_id","request_id","amount_kopeks","status","provider_id","created_at","paid_at" into rec from public.fox_payment_orders where id=(p_data->>'id')::uuid and user_id=u;
  if not found then raise exception 'Платёж не найден';end if;
  return jsonb_build_object('id',rec.id,'status',rec.status,'amount_kopeks',rec.amount_kopeks,'provider_id',rec.provider_id);
 elsif p_action='buy' and p_data->>'pay_in'='rubles' then
  nonce:=(p_data->>'request_id')::uuid;if nonce is null then raise exception 'Нет идентификатора покупки. Обнови лаунчер';end if;
  select "user_id","request_id","product_id","amount_kopeks","created_at" into rec from public.fox_purchase_requests where user_id=u and request_id=nonce;
  if found then
   if rec.product_id<>p_data->>'product' then raise exception 'Идентификатор покупки уже использован';end if;
   return public.fox_action_v130('state') || public.fox_social_state(u);
  end if;
  select "id","title","description","kind","price","currency","tier","days","event_only","reward_currency","reward_amount","enabled","discount_percent","price_kopeks" into cat from public.fox_catalog where id=p_data->>'product' and enabled and kind='subscription' and price_kopeks>0;
  if not found then raise exception 'Рублёвая подписка пока не настроена';end if;
  select item into quote from jsonb_array_elements(public.fox_social_state(u)->'quotes_rub') item where item->>'product'=cat.id;
  if quote->>'mode'='blocked' then raise exception 'У тебя уже подписка выше';end if;
  charge:=(quote->>'price')::bigint;
  if not(p_data ? 'expected_price') or (p_data->>'expected_price')::bigint<>charge then raise exception 'Цена изменилась. Обнови магазин';end if;
  if (select paid_kopeks from public.fox_wallets where id=u)<charge then raise exception 'Недостаточно рублей на платёжном балансе';end if;
  select max(p.expires_at) into expiry from public.fox_purchases p join public.fox_catalog c on c.id=p.product_id where p.user_id=u and c.kind='subscription' and p.expires_at>now();
  expiry:=greatest(now(),coalesce(expiry,now()))+make_interval(days=>cat.days);
  update public.fox_purchases p set expires_at=now() from public.fox_catalog c where c.id=p.product_id and c.kind='subscription' and p.user_id=u and p.expires_at>now();
  insert into public.fox_purchase_requests(user_id,request_id,product_id,amount_kopeks) values(u,nonce,cat.id,charge);
  update public.fox_wallets set paid_kopeks=paid_kopeks-charge where id=u;
  insert into public.fox_purchases(user_id,product_id,expires_at) values(u,cat.id,expiry);
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'paid_kopeks',-charge,'purchase:'||cat.id);
 elsif p_action='pack_prepare' then
  select id into target from public.fox_profiles where public_key=(p_data->>'key')::uuid;
  if not public.fox_are_friends(u,target) then raise exception 'Сначала добавь игрока в друзья';end if;
  if (select count(1) from public.fox_pack_shares where sender=u)>=20 then raise exception 'Лимит: 20 отправленных сборок. Удали старые передачи';end if;
  sid:=gen_random_uuid();
  insert into public.fox_pack_shares(id,sender,recipient,title,object_path,sha256,size_bytes) values(sid,u,target,p_data->>'title',u::text||'/'||sid::text||'.foxpack',p_data->>'sha256',(p_data->>'size')::bigint);
  return (select jsonb_build_object('id',id,'object_path',object_path) from public.fox_pack_shares where id=sid);
 elsif p_action='pack_finish' then
  update public.fox_pack_shares set status='ready' where id=(p_data->>'id')::uuid and sender=u;
  if not found then raise exception 'Передача не найдена';end if;
 elsif p_action='pack_shares' then
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select s.id,s.title,s.size_bytes,s.created_at,p.nickname,s.sender=u outgoing,s.status from public.fox_pack_shares s join public.fox_profiles p on p.id=case when s.sender=u then s.recipient else s.sender end where s.sender=u or (s.recipient=u and public.fox_are_friends(s.sender,s.recipient) and s.status='ready') order by s.created_at desc limit 100) q);
 elsif p_action='pack_remove_info' then
  return (select jsonb_build_object('object_path',object_path) from public.fox_pack_shares where id=(p_data->>'id')::uuid and sender=u);
 elsif p_action='pack_remove' then
  delete from public.fox_pack_shares where id=(p_data->>'id')::uuid and sender=u;
  if not found then raise exception 'Передача не найдена';end if;
 elsif p_action='pack_get' then
  return (select jsonb_build_object('object_path',s.object_path,'sha256',s.sha256,'size_bytes',s.size_bytes,'title',s.title) from public.fox_pack_shares s where s.id=(p_data->>'id')::uuid and u in (s.sender,s.recipient) and public.fox_are_friends(s.sender,s.recipient) and s.status='ready');
 else outcome:=public.fox_action_v130(p_action,p_data);
  -- Existing actions with non-state responses (leaderboard, players, etc.) retain their shape.
  if p_action in ('leaderboard','players','admin_users','start') then return outcome;end if;
 end if;
 return public.fox_action_v130('state') || public.fox_social_state(u) || coalesce(outcome,'{}'::jsonb);
end; $$;
revoke all on function public.fox_action(text,jsonb) from public,anon;
grant execute on function public.fox_action(text,jsonb) to authenticated;
-- Only the server-side payment function may credit real-ruble balances.
create or replace function public.fox_settle_payment(p_order uuid,p_provider uuid,p_kopeks bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare rec public.fox_payment_orders;uid uuid;
begin
 select user_id into uid from public.fox_payment_orders where id=p_order;
 if uid is null then raise exception 'Order not found';end if;
 perform 1 from public.fox_wallets where id=uid for update;
 select "id","user_id","request_id","amount_kopeks","status","provider_id","created_at","paid_at" into rec from public.fox_payment_orders where id=p_order for update;
 if rec.amount_kopeks<>p_kopeks then raise exception 'Amount mismatch';end if;
 if rec.status='succeeded' then
  if rec.provider_id<>p_provider then raise exception 'Provider mismatch';end if;
  return jsonb_build_object('status','succeeded');
 end if;
 if rec.status<>'pending' then raise exception 'Order not pending';end if;
 if rec.provider_id is not null and rec.provider_id<>p_provider then raise exception 'Provider mismatch';end if;
 update public.fox_payment_orders set status='succeeded',provider_id=p_provider,paid_at=now() where id=p_order;
 update public.fox_wallets set paid_kopeks=paid_kopeks+p_kopeks where id=uid;
 insert into public.fox_ledger(user_id,currency,amount,reason) values(uid,'paid_kopeks',p_kopeks,'topup:'||p_order);
 return jsonb_build_object('status','succeeded');
end; $$;
revoke all on function public.fox_settle_payment(uuid,uuid,bigint) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.fox_settle_payment(uuid,uuid,bigint) to service_role;end if;end; $$;
drop function if exists public.fox_record_provider(uuid,uuid,boolean);
create or replace function public.fox_record_provider(p_order uuid,p_provider uuid,p_kopeks bigint,p_canceled boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare rec public.fox_payment_orders;begin
 select "id","user_id","request_id","amount_kopeks","status","provider_id","created_at","paid_at" into rec from public.fox_payment_orders where id=p_order for update;
 if not found then raise exception 'Order not found';end if;
 if rec.provider_id is not null and rec.provider_id<>p_provider then raise exception 'Provider mismatch';end if;
 if rec.amount_kopeks<>p_kopeks then raise exception 'Amount mismatch';end if;
 update public.fox_payment_orders set provider_id=p_provider,status=case when p_canceled and status='pending' then 'canceled' else status end where id=p_order;
end; $$;
revoke all on function public.fox_record_provider(uuid,uuid,bigint,boolean) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.fox_record_provider(uuid,uuid,bigint,boolean) to service_role;end if;end; $$;
commit;
