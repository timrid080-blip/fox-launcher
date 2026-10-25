-- Fox Launcher 2.3: secure promo-code application to Fox currency purchases.
-- Apply AFTER migrate-2.2.sql. Back up the database first.
begin;
create table if not exists public.fox_code_redemptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.fox_profiles(id) on delete cascade,
 code_id uuid not null references public.fox_codes(id) on delete cascade,
 product_id text not null,
 discount_percent integer not null check(discount_percent between 0 and 90),
 created_at timestamptz not null default now(),
 unique(user_id,code_id)
);
alter table public.fox_code_redemptions enable row level security;
revoke all on public.fox_code_redemptions from public,anon,authenticated;
create or replace function public.fox_action_v130(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid := auth.uid(); adm boolean; w public.fox_wallets; c public.fox_catalog; ev public.fox_events; se public.fox_sessions; target uuid; n bigint; elapsed bigint; total_time bigint; max_time bigint; expires timestamptz; old_exp timestamptz; old_coins bigint; fresh boolean; sid uuid; result jsonb; nick text; today date := (now() at time zone 'UTC')::date; day_seconds bigint; daily_row public.fox_daily_rewards; quest record; period_day date; metric_name text; drop_id text; quote jsonb; active_sub jsonb; charge bigint; promo_row record; promo_discount integer;
begin
 if u is null then raise exception 'Требуется вход в аккаунт Fox'; end if;
 select exists(select 1 from public.fox_admins where id=u) into adm;
 if not exists(select 1 from public.fox_profiles where id=u) then
  select raw_user_meta_data->>'nickname' into nick from auth.users where id=u;
  if nick is null or nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Ник: 3–16 латинских букв, цифр или _'; end if;
  insert into public.fox_profiles(id,nickname) values(u,nick) on conflict do nothing;
 end if;
 insert into public.fox_wallets(id) values(u) on conflict do nothing;
 select * into w from public.fox_wallets where id=u for update;
 select * into ev from public.fox_events where enabled and starts_at<=now() and ends_at>now() order by starts_at desc limit 1;
 if p_action='start' then
  if length(coalesce(p_data->>'instance','')) not between 1 and 160 then raise exception 'Неверная сборка'; end if;
  insert into public.fox_sessions(user_id,instance_id) values(u,p_data->>'instance') on conflict(user_id) do update set id=gen_random_uuid(),instance_id=excluded.instance_id,last_beat=now(),event_seconds=0,event_id=null returning id into sid;
  return jsonb_build_object('session',sid);
 elsif p_action in ('beat','end') then
  select * into se from public.fox_sessions where user_id=u and id=(p_data->>'session')::uuid for update;
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
  select * into daily_row from public.fox_daily_rewards where user_id=u;
  if daily_row.last_claim=today then raise exception 'Ежедневная награда уже получена. Новый день — в 00:00 UTC'; end if;
  n:=case when daily_row.last_claim=today-1 then least(7,daily_row.streak+1) else 1 end;
  insert into public.fox_daily_rewards(user_id,last_claim,streak) values(u,today,n) on conflict(user_id) do update set last_claim=excluded.last_claim,streak=excluded.streak;
  n:=25+5*(n-1);
  update public.fox_wallets set foxes=foxes+n where id=u;
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'foxes',n,'daily:'||today);
 elsif p_action='quest_claim' then
  select * into quest from public.fox_quest_status(u) where code=p_data->>'quest';
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
    when 'quests' then (select count(*) from public.fox_quest_claims where user_id=p.id)
    when 'foxes' then wr.foxes else wr.pumpkins end score
   from public.fox_profiles p join public.fox_wallets wr on wr.id=p.id where p.leaderboard_visible and p.stats_visibility='all'
  ), ranked as (select *,rank() over(order by score desc) place from scores)
  select jsonb_build_object('metric',metric_name,'participants',(select count(*) from ranked),
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
 elsif p_action='promo_validate' then
  if p_data->>'code' is null or upper(trim(p_data->>'code')) !~ '^[A-Z0-9_-]{3,24}$' then raise exception 'Промокод имеет неверный формат'; end if;
  select * into promo_row from public.fox_codes where code=upper(trim(p_data->>'code')) and enabled;
  if not found then raise exception 'Промокод не найден или отключён'; end if;
  if exists(select 1 from public.fox_code_redemptions where user_id=u and code_id=promo_row.id) then raise exception 'Ты уже использовал этот промокод'; end if;
  return jsonb_build_object('code',promo_row.code,'kind',promo_row.kind,'discount_percent',promo_row.discount_percent);
 elsif p_action='buy' then
  select * into c from public.fox_catalog where id=p_data->>'product' and enabled;
  if not found then raise exception 'Товар недоступен'; end if;
  active_sub:=public.fox_subscription_state(u)->'active_subscription';
  select item into quote from jsonb_array_elements(public.fox_subscription_state(u)->'quotes') item where item->>'product'=c.id;
  if quote->>'mode'='blocked' then raise exception 'У тебя уже подписка выше. Дождись окончания или улучши её'; end if;
  charge:=(quote->>'price')::bigint;
  promo_discount:=0;
  if nullif(trim(coalesce(p_data->>'promo_code','')),'') is not null then
   select * into promo_row from public.fox_codes where code=upper(trim(p_data->>'promo_code')) and enabled;
   if not found then raise exception 'Промокод не найден или отключён'; end if;
   if exists(select 1 from public.fox_code_redemptions where user_id=u and code_id=promo_row.id) then raise exception 'Ты уже использовал этот промокод'; end if;
   promo_discount:=promo_row.discount_percent;
   charge:=floor(charge*(100-promo_discount)/100.0)::bigint;
  end if;
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
  if promo_discount>0 then insert into public.fox_code_redemptions(user_id,code_id,product_id,discount_percent) values(u,promo_row.id,c.id,promo_discount); end if;
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
end $$;
revoke all on function public.fox_action(text,jsonb) from public,anon;
grant execute on function public.fox_action(text,jsonb) to authenticated;
commit;
