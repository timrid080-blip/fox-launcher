-- Existing Fox Launcher 1.1 database ONLY. Run once in Supabase SQL editor.
-- Transactional: on any error none of this migration is committed.
begin;

-- Fox Club 1.2: UTC rewards, quests, opt-in rankings and launcher-only cosmetics.
alter table public.fox_profiles add column leaderboard_visible boolean not null default false;
alter table public.fox_profiles add column equipped_cosmetic text references public.fox_catalog(id);
alter table public.fox_catalog drop constraint fox_catalog_kind_check;
alter table public.fox_catalog add constraint fox_catalog_kind_check check(kind in ('subscription','cosmetic','exchange','case'));
create table public.fox_daily_rewards(user_id uuid primary key references auth.users on delete cascade, last_claim date not null, streak integer not null check(streak between 1 and 7));
create table public.fox_daily_play(user_id uuid not null references auth.users on delete cascade, day date not null, instance_id text not null, seconds bigint not null check(seconds>=0), primary key(user_id,day,instance_id));
create table public.fox_quest_claims(user_id uuid not null references auth.users on delete cascade, code text not null, period date not null, claimed_at timestamptz not null default now(), primary key(user_id,code,period));
alter table public.fox_daily_rewards enable row level security;
alter table public.fox_daily_play enable row level security;
alter table public.fox_quest_claims enable row level security;
revoke all on public.fox_daily_rewards,public.fox_daily_play,public.fox_quest_claims from public,anon,authenticated;
insert into public.fox_catalog(id,title,description,kind,price,currency) values
 ('fox-hat','Лисья шапка','Значок-шапка на карточке профиля Fox. Только в лаунчере.','cosmetic',120,'foxes'),
 ('night-cape','Ночной плащ','Звёздное оформление карточки Fox. Не плащ персонажа Minecraft.','cosmetic',180,'foxes'),
 ('star-art','Звёздный рисунок','Готовый рисунок для карточки Fox. Только в лаунчере.','cosmetic',150,'foxes'),
 ('style-case','Кейс стиля','Один из трёх аксессуаров: Лисья шапка, Ночной плащ, Звёздный рисунок. Равные шансы среди ещё не полученных. Без повторов, продажи и вывода.','case',90,'foxes');

create function public.fox_quest_status(p_user uuid)
returns table(code text,title text,scope text,metric text,goal bigint,reward bigint,progress bigint,claimed boolean)
language sql stable security definer set search_path='' as $$
 select q.code,q.title,q.scope,q.metric,q.goal,q.reward,
 case when q.scope='daily' then case when q.metric='seconds' then d.seconds else d.worlds end
 else case when q.metric='seconds' then a.seconds else a.worlds end end,
 exists(select 1 from public.fox_quest_claims c where c.user_id=p_user and c.code=q.code and c.period=case when q.scope='daily' then (now() at time zone 'UTC')::date else date '1970-01-01' end)
 from (values
 ('play15','Разминка: 15 минут','daily','seconds',900::bigint,20::bigint),
 ('play60','Час приключений','daily','seconds',3600,60),
 ('worlds2','Две сборки за день','daily','worlds',2,30),
 ('journey10','Большое путешествие: 10 часов','career','seconds',36000,200),
 ('worlds5','Исследователь: 5 сборок','career','worlds',5,100)
 ) q(code,title,scope,metric,goal,reward)
 cross join lateral (select coalesce(sum(seconds),0)::bigint seconds,count(*) filter(where seconds>0) worlds from public.fox_daily_play where user_id=p_user and day=(now() at time zone 'UTC')::date) d
 cross join lateral (select coalesce(sum(seconds),0)::bigint seconds,count(*) filter(where seconds>0) worlds from public.fox_progress where user_id=p_user) a;
$$;
revoke all on function public.fox_quest_status(uuid) from public,anon,authenticated;

create function public.fox_club_state(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('club_version',2,'server_now',now(),'daily',jsonb_build_object(
 'claimed',coalesce(d.last_claim=(now() at time zone 'UTC')::date,false),
 'streak',coalesce(case when d.last_claim>=(now() at time zone 'UTC')::date-1 then d.streak else 0 end,0),
 'reward',25+5*(case when d.last_claim=(now() at time zone 'UTC')::date then d.streak when d.last_claim=(now() at time zone 'UTC')::date-1 then least(7,d.streak+1) else 1 end-1),
 'next_reset',(((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC')),
 'quests',(select coalesce(jsonb_agg(to_jsonb(q) order by q.scope desc,q.goal),'[]'::jsonb) from public.fox_quest_status(p_user) q))
 from (select 1) seed left join public.fox_daily_rewards d on d.user_id=p_user;
$$;
revoke all on function public.fox_club_state(uuid) from public,anon,authenticated;

create or replace function public.fox_action(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid := auth.uid(); adm boolean; w public.fox_wallets; c public.fox_catalog; ev public.fox_events; se public.fox_sessions; target uuid; n bigint; elapsed bigint; total_time bigint; max_time bigint; expires timestamptz; old_exp timestamptz; old_coins bigint; fresh boolean; sid uuid; result jsonb; nick text; today date := (now() at time zone 'UTC')::date; day_seconds bigint; daily_row public.fox_daily_rewards; quest record; period_day date; metric_name text; drop_id text;
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
   from public.fox_profiles p join public.fox_wallets wr on wr.id=p.id where p.leaderboard_visible
  ), ranked as (select *,rank() over(order by score desc) place from scores)
  select jsonb_build_object('metric',metric_name,'participants',(select count(*) from ranked),
   'items',(select coalesce(jsonb_agg(to_jsonb(t) order by t.score desc,t.nickname,t.sort_id),'[]'::jsonb) from (select place,nickname,score,equipped_cosmetic,id=u self,id sort_id from ranked order by score desc,nickname,id limit 50) t),
   'self',(select jsonb_build_object('place',place,'nickname',nickname,'score',score) from ranked where id=u)) into result;
  -- Do not publish Auth UUIDs, email addresses, ruble balances or transaction logs.
  result:=jsonb_set(result,'{items}',(select coalesce(jsonb_agg(item-'sort_id'),'[]'::jsonb) from jsonb_array_elements(result->'items') item));
  return result;
 elsif p_action='buy' then
  select * into c from public.fox_catalog where id=p_data->>'product' and enabled;
  if not found then raise exception 'Товар недоступен'; end if;
  if c.kind='case' then
   if c.id<>'style-case' then raise exception 'Кейс недоступен'; end if;
   select cat.id into drop_id from public.fox_catalog cat where cat.id in ('fox-hat','night-cape','star-art') and cat.enabled and not exists(select 1 from public.fox_purchases p where p.user_id=u and p.product_id=cat.id) order by random() limit 1;
   if drop_id is null then raise exception 'Все аксессуары кейса уже собраны. Фоксы не списаны'; end if;
  end if;
  if c.event_only and ev.id is null then raise exception 'Сейчас нет активного ивента'; end if;
  if c.kind='cosmetic' and exists(select 1 from public.fox_purchases where user_id=u and product_id=c.id) then raise exception 'Уже куплено'; end if;
  if (case c.currency when 'foxes' then w.foxes when 'pumpkins' then w.pumpkins else w.rubles end)<c.price then raise exception 'Недостаточно средств'; end if;
  update public.fox_wallets set foxes=foxes-case when c.currency='foxes' then c.price else 0 end,pumpkins=pumpkins-case when c.currency='pumpkins' then c.price else 0 end,rubles=rubles-case when c.currency='rubles' then c.price else 0 end where id=u;
  if c.kind='exchange' then
   update public.fox_wallets set foxes=foxes+case when c.reward_currency='foxes' then c.reward_amount else 0 end,pumpkins=pumpkins+case when c.reward_currency='pumpkins' then c.reward_amount else 0 end where id=u;
   insert into public.fox_ledger(user_id,currency,amount,reason) values(u,c.reward_currency,c.reward_amount,'exchange:'||c.id);
  end if;
  if c.kind='subscription' then
   select max(p.expires_at) into old_exp from public.fox_purchases p where p.user_id=u and p.product_id=c.id;
   expires:=greatest(now(),coalesce(old_exp,now()))+make_interval(days=>c.days);
  end if;
  insert into public.fox_purchases(user_id,product_id,expires_at) values(u,c.id,expires);
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,c.currency,-c.price,'purchase:'||c.id);
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
 return jsonb_build_object('profile',(select to_jsonb(p) from public.fox_profiles p where p.id=u),'is_admin',adm,'wallet',(select to_jsonb(wr) from public.fox_wallets wr where wr.id=u),'catalog',(select coalesce(jsonb_agg(to_jsonb(catrow)),'[]'::jsonb) from public.fox_catalog catrow where enabled),'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.fox_events e where (enabled or adm) and (ends_at>now() or adm)),'purchases',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.fox_purchases p where user_id=u),'achievements',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.fox_achievements a where user_id=u),'progress',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.fox_progress p where user_id=u),'ledger',(select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select currency,amount,reason,created_at from public.fox_ledger where user_id=u order by created_at desc limit 30) q)) || public.fox_club_state(u) || coalesce(result,'{}'::jsonb);
end $$;
revoke all on function public.fox_action(text,jsonb) from public,anon;
grant execute on function public.fox_action(text,jsonb) to authenticated;
commit;
