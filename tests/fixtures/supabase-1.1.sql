-- Fox Launcher 1.1.0. Run once in a NEW Supabase project SQL editor.
-- No service_role key belongs in a launcher. Enable email confirmation in Auth.
begin;
create table public.fox_profiles (id uuid primary key references auth.users on delete cascade, nickname text not null check(nickname ~ '^[A-Za-z0-9_]{3,16}$'), created_at timestamptz not null default now());
create table public.fox_admins (id uuid primary key references auth.users on delete cascade);
create table public.fox_wallets (id uuid primary key references auth.users on delete cascade, foxes bigint not null default 0 check(foxes>=0), pumpkins bigint not null default 0 check(pumpkins>=0), rubles bigint not null default 0 check(rubles>=0));
create table public.fox_events (id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 100), theme text not null check(theme in ('halloween','newyear','winter','spring','summer','birthday','valentine')), starts_at timestamptz not null, ends_at timestamptz not null, enabled boolean not null default true, check(ends_at>starts_at));
create table public.fox_catalog (id text primary key, title text not null, description text not null, kind text not null check(kind in ('subscription','cosmetic','exchange')), price bigint not null check(price>0), currency text not null check(currency in ('foxes','pumpkins','rubles')), tier int not null default 0, days int not null default 0 check(days>=0), event_only boolean not null default false, reward_currency text check(reward_currency in ('foxes','pumpkins')), reward_amount bigint not null default 0 check(reward_amount>=0), enabled boolean not null default true);
create table public.fox_purchases (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, product_id text not null references public.fox_catalog, created_at timestamptz not null default now(), expires_at timestamptz);
create table public.fox_ledger (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, actor uuid references auth.users, currency text not null, amount bigint not null, reason text not null, created_at timestamptz not null default now());
create table public.fox_progress (user_id uuid not null references auth.users on delete cascade, instance_id text not null, seconds bigint not null default 0, primary key(user_id,instance_id));
create table public.fox_sessions (user_id uuid primary key references auth.users on delete cascade, id uuid not null default gen_random_uuid(), instance_id text not null, last_beat timestamptz not null default now(), event_seconds bigint not null default 0, event_id uuid references public.fox_events on delete set null);
create table public.fox_achievements (user_id uuid not null references auth.users on delete cascade, code text not null, unlocked_at timestamptz not null default now(), primary key(user_id,code));
insert into public.fox_catalog(id,title,description,kind,price,currency,tier,days) values
 ('plus','Fox Plus','Редактор скинов, значок Plus. На 30 дней. Первые 100 Фоксов — за достижение Геймер.','subscription',100,'foxes',1,30),
 ('pro','Fox Pro','Всё из Plus и значок Pro. На 30 дней.','subscription',700,'foxes',2,30),
 ('exclusive','Fox Exclusive','Всё из Pro и эксклюзивный значок. На 30 дней.','subscription',1500,'foxes',3,30);
insert into public.fox_catalog(id,title,description,kind,price,currency,event_only) values
 ('pumpkin-frame','Тыквенная рамка','Рамка профиля лаунчера. Не аксессуар Minecraft.','cosmetic',30,'pumpkins',true),
 ('fox-badge','Лисья эмблема','Эмблема профиля лаунчера.','cosmetic',200,'foxes',false);
-- Rubles are MANUAL NON-CASH credits, not a payment balance. No top-ups/withdrawals.
insert into public.fox_catalog(id,title,description,kind,price,currency,event_only,reward_currency,reward_amount) values
 ('foxes-100','100 Фоксов','Обмен 100 учётных рублей; это не настоящая оплата.','exchange',100,'rubles',false,'foxes',100),
 ('pumpkins-20','20 тыкв','Обмен 100 Фоксов. Только во время включённого ивента.','exchange',100,'foxes',true,'pumpkins',20);
-- Every table is private by default. All writes below are through one audited RPC.
alter table public.fox_profiles enable row level security;
alter table public.fox_admins enable row level security;
alter table public.fox_wallets enable row level security;
alter table public.fox_events enable row level security;
alter table public.fox_catalog enable row level security;
alter table public.fox_purchases enable row level security;
alter table public.fox_ledger enable row level security;
alter table public.fox_progress enable row level security;
alter table public.fox_sessions enable row level security;
alter table public.fox_achievements enable row level security;
revoke all on public.fox_profiles,public.fox_admins,public.fox_wallets,public.fox_events,public.fox_catalog,public.fox_purchases,public.fox_ledger,public.fox_progress,public.fox_sessions,public.fox_achievements from anon,authenticated;
create function public.fox_action(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid := auth.uid(); adm boolean; w public.fox_wallets; c public.fox_catalog; ev public.fox_events; se public.fox_sessions; target uuid; n bigint; elapsed bigint; total_time bigint; max_time bigint; expires timestamptz; old_exp timestamptz; old_coins bigint; fresh boolean; sid uuid; result jsonb; nick text;
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
 elsif p_action='buy' then
  select * into c from public.fox_catalog where id=p_data->>'product' and enabled;
  if not found then raise exception 'Товар недоступен'; end if;
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
 return jsonb_build_object('profile',(select to_jsonb(p) from public.fox_profiles p where p.id=u),'is_admin',adm,'wallet',(select to_jsonb(wr) from public.fox_wallets wr where wr.id=u),'catalog',(select coalesce(jsonb_agg(to_jsonb(catrow)),'[]'::jsonb) from public.fox_catalog catrow where enabled),'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.fox_events e where (enabled or adm) and (ends_at>now() or adm)),'purchases',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.fox_purchases p where user_id=u),'achievements',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.fox_achievements a where user_id=u),'progress',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.fox_progress p where user_id=u),'ledger',(select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (select currency,amount,reason,created_at from public.fox_ledger where user_id=u order by created_at desc limit 30) q));
end $$;
revoke all on function public.fox_action(text,jsonb) from public,anon;
grant execute on function public.fox_action(text,jsonb) to authenticated;
commit;
-- AFTER registering YOUR account and confirming email, run manually in SQL editor:
-- insert into public.fox_admins(id) values ('YOUR-AUTH-USER-UUID');
-- Never add friends to fox_admins. Role is NOT read from user-editable metadata.
