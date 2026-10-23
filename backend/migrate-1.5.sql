-- Fox Launcher 1.5: apply AFTER migrate-1.4.sql. Back up first.
-- No asterisk characters: safe plain-text delivery. Transactional and repeatable.
begin;
alter table public.fox_profiles add column if not exists banned boolean not null default false;
alter table public.fox_profiles add column if not exists ban_reason text not null default '';
alter table public.fox_profiles add column if not exists spending_frozen boolean not null default false;
create table if not exists public.fox_notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,title text not null,body text not null,kind text not null default 'info',created_at timestamptz not null default now(),read_at timestamptz);
create index if not exists fox_notifications_user_time on public.fox_notifications(user_id,created_at desc);
alter table public.fox_notifications enable row level security;
revoke all on public.fox_notifications from public,anon,authenticated;

create or replace function public.fox_notify(p_user uuid,p_title text,p_body text,p_kind text default 'info') returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.fox_notifications(user_id,title,body,kind) values(p_user,left(p_title,160),left(p_body,1000),p_kind);
 -- Bound inbox to the newest 200 messages per account.
 delete from public.fox_notifications where user_id=p_user and id in (select n.id from public.fox_notifications n where n.user_id=p_user order by n.created_at desc,n.id desc offset 200);
end; $$;
revoke all on function public.fox_notify(uuid,text,text,text) from public,anon,authenticated;
create or replace function public.fox_ledger_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare label text;why text;
begin
 label:=case new.currency when 'foxes' then 'Фоксов' when 'pumpkins' then 'тыкв' when 'paid_kopeks' then 'коп. платёжного баланса' else 'учётных рублей' end;
 why:=case when new.reason like 'quest:%' then 'Награда за квест' when new.reason like 'daily:%' then 'Ежедневный подарок' when new.reason like 'achievement:%' then 'Достижение: '||split_part(new.reason,':',2) when new.reason like 'event:%' then 'За 5 минут игры во время ивента' when new.reason like 'topup:%' then 'Подтверждённая оплата' else new.reason end;
 perform public.fox_notify(new.user_id,case when new.amount>0 then 'Вам зачислено ' else 'Списано ' end||abs(new.amount)||' '||label,why,'wallet');return new;
end; $$;
revoke all on function public.fox_ledger_notice() from public,anon,authenticated;
drop trigger if exists fox_ledger_notice on public.fox_ledger;
create trigger fox_ledger_notice after insert on public.fox_ledger for each row execute function public.fox_ledger_notice();

create or replace function public.fox_quest_status(p_user uuid)
returns table(code text,title text,scope text,metric text,goal bigint,reward bigint,progress bigint,claimed boolean)
language sql stable security definer set search_path='' as $$
 with clock as (select (now() at time zone 'UTC')::date today,date_trunc('week',now() at time zone 'UTC')::date week_start),
 defs(code,title,scope,metric,goal,reward) as (values
 ('play15','Разминка: 15 минут','daily','seconds',900::bigint,20::bigint),
 ('play60','Час приключений','daily','seconds',3600,60),
 ('worlds2','Две сборки за день','daily','worlds',2,30),
 ('daily30','Полчаса в своём мире','daily','seconds',1800,35),
 ('daily90','Вечер приключений','daily','seconds',5400,80),
 ('week3h','Три часа за неделю','weekly','seconds',10800,180),
 ('week8h','Неделя приключений: 8 часов','weekly','seconds',28800,400),
 ('week3packs','Три сборки за неделю','weekly','worlds',3,160),
 ('journey10','Большое путешествие: 10 часов','career','seconds',36000,200),
 ('worlds5','Исследователь: 5 сборок','career','worlds',5,100),
 ('journey50','Легенда путешествий: 50 часов','career','seconds',180000,800)),
 periods as (select d.code,d.title,d.scope,d.metric,d.goal,d.reward,case d.scope when 'daily' then c.today when 'weekly' then c.week_start else date '1970-01-01' end period_day from defs d cross join clock c)
 select q.code,q.title,q.scope,q.metric,q.goal,q.reward,
 case when q.scope='career' then (select case q.metric when 'seconds' then coalesce(sum(p.seconds),0)::bigint else count(1) filter(where p.seconds>0) end from public.fox_progress p where p.user_id=p_user)
 else (select case q.metric when 'seconds' then coalesce(sum(p.seconds),0)::bigint else count(distinct p.instance_id) filter(where p.seconds>0) end from public.fox_daily_play p cross join clock c where p.user_id=p_user and p.day>=q.period_day and p.day<=c.today) end,
 exists(select 1 from public.fox_quest_claims k where k.user_id=p_user and k.code=q.code and k.period=q.period_day)
 from periods q;
$$;
revoke all on function public.fox_quest_status(uuid) from public,anon,authenticated;

create or replace function public.fox_award_extra(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare secs bigint;packs bigint;quests bigint;item record;
begin
 select coalesce(sum(seconds),0),count(1) filter(where seconds>0) into secs,packs from public.fox_progress where user_id=p_user;
 select count(1) into quests from public.fox_quest_claims where user_id=p_user;
 for item in select code,title,reward from (values ('first30','Первые полчаса',50,secs>=1800),('explorer3','Три мира',100,packs>=3),('veteran25','Ветеран: 25 часов',300,secs>=90000),('quests10','Охотник за квестами',200,quests>=10),('quests30','Мастер заданий',500,quests>=30)) q(code,title,reward,ready) where ready loop
  insert into public.fox_achievements(user_id,code) values(p_user,item.code) on conflict do nothing;
  if found then
   update public.fox_wallets set foxes=foxes+item.reward where id=p_user;
   insert into public.fox_ledger(user_id,currency,amount,reason) values(p_user,'foxes',item.reward,'achievement:'||item.title);
  end if;
 end loop;
end; $$;
revoke all on function public.fox_award_extra(uuid) from public,anon,authenticated;

insert into public.fox_catalog(id,title,description,kind,price,currency) values
 ('witch-hat','Шляпа ведьмы','Halloween-значок в профиле Fox Launcher. Не предмет Minecraft.','cosmetic',25,'pumpkins'),
 ('ghost-friend','Призрачный спутник','Дружелюбное привидение на карточке Fox. Только в лаунчере.','cosmetic',35,'pumpkins'),
 ('bat-wings','Крылья ночи','Летучая мышь на карточке Fox. Только в лаунчере.','cosmetic',40,'pumpkins'),
 ('jack-lantern','Фонарь Джека','Тыквенный значок для осенних приключений. Только в лаунчере.','cosmetic',20,'pumpkins')
on conflict(id) do nothing;

-- Keep the previous RPC private; do not rename again on a repeated migration.
do $$ begin
 if to_regprocedure('public.fox_action_v140(text,jsonb)') is null then alter function public.fox_action(text,jsonb) rename to fox_action_v140;end if;
end; $$;
revoke all on function public.fox_action_v140(text,jsonb) from public,anon,authenticated;
create or replace function public.fox_action(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();adm boolean;banned_user boolean;frozen boolean;reason text;r jsonb;target uuid;q record;period_day date;before_pumpkins bigint;after_pumpkins bigint;friend_user uuid;
begin
 if u is null then raise exception 'Требуется вход в Fox ID';end if;
 select exists(select 1 from public.fox_admins where id=u) into adm;
 -- Serialize moderation with purchases/rewards on the target wallet.
 perform 1 from public.fox_wallets where id=u for update;
 select banned,spending_frozen,ban_reason into banned_user,frozen,reason from public.fox_profiles where id=u;
 if coalesce(banned_user,false) and not adm and p_action not in ('state','notifications','notification_read','support_create','support_list','support_get','support_reply','support_close') then raise exception 'Fox ID заблокирован: %. Обжалование — через поддержку.',reason;end if;
 if coalesce(banned_user,false) and not adm and p_action like 'support_%' then
  if coalesce((p_data->>'work')::boolean,false) or (p_action in ('support_get','support_reply','support_close') and not exists(select 1 from public.fox_tickets where id=(p_data->>'id')::uuid and user_id=u)) then raise exception 'Блокировка Fox ID: доступ только к собственным обращениям';end if;
 end if;
 if coalesce(frozen,false) and p_action in ('buy','payment_order') then raise exception 'Расходы по балансу заморожены. Обратитесь в поддержку.';end if;
 if p_action in ('pack_prepare','pack_finish','pack_get','pack_shares','pack_remove','pack_remove_info') then raise exception 'Онлайн-передача отключена. Используйте экспорт и импорт .foxpack.';end if;
 if p_action='admin_moderate' then
  if not adm then raise exception 'Доступ только владельцу';end if;
  target:=(p_data->>'user')::uuid;
  if target is null or not exists(select 1 from public.fox_profiles where id=target) then raise exception 'Игрок не найден';end if;
  if exists(select 1 from public.fox_admins where id=target) then raise exception 'Нельзя блокировать или замораживать владельца';end if;
  if length(trim(coalesce(p_data->>'reason','')))<3 or length(p_data->>'reason')>200 then raise exception 'Причина: 3–200 символов';end if;
  if p_data->>'operation' not in ('ban','unban','freeze','unfreeze') then raise exception 'Неизвестное действие';end if;
  perform 1 from public.fox_wallets where id=target for update;
  if p_data->>'operation' in ('ban','unban') then
   update public.fox_profiles set banned=(p_data->>'operation'='ban'),ban_reason=case when p_data->>'operation'='ban' then trim(p_data->>'reason') else '' end where id=target;
   if p_data->>'operation'='ban' then delete from public.fox_sessions where user_id=target;end if;
  else update public.fox_profiles set spending_frozen=(p_data->>'operation'='freeze') where id=target;end if;
  insert into public.fox_staff_audit(actor,action,data) values(u,'moderation',p_data);
  perform public.fox_notify(target,'Действие владельца',case p_data->>'operation' when 'ban' then 'Fox ID заблокирован. ' when 'unban' then 'Блокировка Fox ID снята. ' when 'freeze' then 'Расходы по балансу заморожены. Награды продолжают начисляться. ' else 'Заморозка расходов снята. ' end||trim(p_data->>'reason'),'moderation');
  return jsonb_build_object('ok',true);
 elsif p_action='moderation_users' then
  if not adm then raise exception 'Доступ только владельцу';end if;
  return (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select p.id,p.nickname,p.banned,p.ban_reason,p.spending_frozen from public.fox_profiles p order by p.nickname limit 500) t);
 elsif p_action='notifications' then
  return jsonb_build_object('unread',(select count(1) from public.fox_notifications where user_id=u and read_at is null),'items',(select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc),'[]'::jsonb) from (select id,title,body,kind,created_at,read_at from public.fox_notifications where user_id=u order by created_at desc,id desc limit 100) n));
 elsif p_action='notification_read' then
  if coalesce((p_data->>'all')::boolean,false) then update public.fox_notifications set read_at=now() where user_id=u and read_at is null;
  else update public.fox_notifications set read_at=now() where user_id=u and id=(p_data->>'id')::uuid and read_at is null;end if;
  return jsonb_build_object('ok',true);
 elsif p_action='quest_claim' then
  perform public.fox_action_v140('state');
  select code,title,scope,metric,goal,reward,progress,claimed into q from public.fox_quest_status(u) where code=p_data->>'quest';
  if not found then raise exception 'Квест не найден';end if;
  if q.claimed then raise exception 'Награда за квест уже получена';end if;
  if q.progress<q.goal then raise exception 'Квест ещё не выполнен';end if;
  period_day:=case q.scope when 'daily' then (now() at time zone 'UTC')::date when 'weekly' then date_trunc('week',now() at time zone 'UTC')::date else date '1970-01-01' end;
  insert into public.fox_quest_claims(user_id,code,period) values(u,q.code,period_day);
  update public.fox_wallets set foxes=foxes+q.reward where id=u;
  insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'foxes',q.reward,'quest:'||q.code||':'||period_day);
  perform public.fox_award_extra(u);
  r:=public.fox_action_v140('state');
 else
  select pumpkins into before_pumpkins from public.fox_wallets where id=u;
  if p_action='friend_accept' then select sender into friend_user from public.fox_friends where id=(p_data->>'id')::uuid and recipient=u;end if;
  r:=public.fox_action_v140(p_action,p_data);
  if p_action in ('beat','end','state') and not coalesce(banned_user,false) then
   perform public.fox_award_extra(u);
   if p_action in ('beat','end') then
    select pumpkins into after_pumpkins from public.fox_wallets where id=u;
    if after_pumpkins>before_pumpkins then insert into public.fox_ledger(user_id,currency,amount,reason) values(u,'pumpkins',after_pumpkins-before_pumpkins,'event:5min');end if;
   end if;
   r:=r||jsonb_build_object('wallet',(select to_jsonb(w) from public.fox_wallets w where id=u),'achievements',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.fox_achievements a where user_id=u));
  end if;
  if p_action='friend_request' then
   select id into friend_user from public.fox_profiles where public_key=(p_data->>'key')::uuid;
   if friend_user is not null then perform public.fox_notify(friend_user,'Заявка в друзья',(select nickname from public.fox_profiles where id=u)||' хочет добавить вас в друзья.','friend');end if;
  elsif p_action='friend_accept' and friend_user is not null then perform public.fox_notify(friend_user,'Новый друг','Ваша заявка в друзья принята.','friend');
  elsif p_action='support_reply' then
   select user_id into friend_user from public.fox_tickets where id=(p_data->>'id')::uuid;
   if friend_user<>u then perform public.fox_notify(friend_user,'Ответ поддержки','Откройте своё обращение в разделе «Поддержка».','support');end if;
  end if;
 end if;
 if jsonb_typeof(r)='object' then
  r:=r||jsonb_build_object('features_version',5,'moderation',(select jsonb_build_object('banned',p.banned,'reason',p.ban_reason,'spending_frozen',p.spending_frozen) from public.fox_profiles p where p.id=u),'weekly_reset',(date_trunc('week',now() at time zone 'UTC')+interval '7 days') at time zone 'UTC');
 end if;
 return r;
end; $$;
revoke all on function public.fox_action(text,jsonb) from public,anon;
grant execute on function public.fox_action(text,jsonb) to authenticated;
-- Payments remain OFF until the owner deliberately configures and tests a provider.
update public.fox_payment_settings set enabled=false where id=1;
commit;
