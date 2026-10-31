-- Fox Launcher 5.0.0 consolidated backend migration
-- Purpose: one SQL script for the post-2.4 backend additions currently
-- split across migrations 2.5–4.0.0, including both historically named 2.7 files.
--
-- IMPORTANT:
-- 1) Back up your Supabase database before running this script.
-- 2) This consolidates the post-2.4 feature migrations; it does NOT replace
--    the initial schema or migrations 1.2–2.4 on a database that lacks them.
-- 3) Uses CREATE OR REPLACE / IF NOT EXISTS where the source migrations did.
--    Review errors carefully; do not run in parallel with other migrations.
begin;


-- =====================================================================
-- Included from backend/migrate-2.5-presence.sql
-- =====================================================================
-- Fox Launcher presence v1. Apply in Supabase SQL Editor after migrate-2.4.sql.

create table if not exists public.fox_presence (
 user_id uuid primary key references auth.users(id) on delete cascade,
 last_seen timestamptz not null default now(),
 activity text not null default 'active' check(activity in ('active','afk','away'))
);
alter table public.fox_presence enable row level security;
revoke all on public.fox_presence from public, anon, authenticated;

create or replace function public.fox_presence(p_op text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); target uuid; v_activity text;
begin
 if u is null then raise exception 'Требуется вход в аккаунт Fox'; end if;
 insert into public.fox_profiles(id,nickname)
 select u, raw_user_meta_data->>'nickname' from auth.users where id=u
 on conflict(id) do nothing;
 if p_op='beat' then
   v_activity:=coalesce(p_data->>'activity','active');
   if v_activity not in ('active','afk','away') then v_activity:='active'; end if;
   insert into public.fox_presence(user_id,last_seen,activity) values(u,now(),v_activity)
   on conflict(user_id) do update set last_seen=now(),activity=excluded.activity;
   return jsonb_build_object('ok',true);
 elsif p_op='friends' then
   return (select coalesce(jsonb_agg(jsonb_build_object(
     'public_key',p.public_key,'nickname',p.nickname,'activity',
     case when pr.last_seen is null or pr.last_seen<now()-interval '5 minutes' then 'offline'
          when pr.activity='afk' then 'afk'
          when pr.activity='away' then 'away'
          else 'online' end,
     'last_seen',pr.last_seen
   ) order by lower(p.nickname)),'[]'::jsonb)
   from public.fox_friends f
   join public.fox_profiles p on p.id=case when f.sender=u then f.recipient else f.sender end
   left join public.fox_presence pr on pr.user_id=p.id
   where f.status='accepted' and u in (f.sender,f.recipient));
 else raise exception 'Неизвестная операция присутствия'; end if;
end; $$;
revoke all on function public.fox_presence(text,jsonb) from public,anon;
grant execute on function public.fox_presence(text,jsonb) to authenticated;


-- =====================================================================
-- Included from backend/migrate-2.6-launcher-modes.sql
-- =====================================================================
-- Fox Launcher global alert / maintenance modes.
-- Apply once in the Supabase SQL editor after the existing Fox Club migrations.

create table if not exists public.fox_launcher_mode_state (
  id integer primary key check (id = 1),
  mode text check (mode in ('alarm','ceremony','maintenance','warning','celebration','info')),
  message text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (mode is null or (starts_at is not null and (ends_at is null or ends_at > starts_at)))
);
insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;
alter table public.fox_launcher_mode_state enable row level security;
revoke all on public.fox_launcher_mode_state from public, anon, authenticated;

create or replace function public.fox_launcher_mode(p_op text default 'get', p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := auth.uid();
  adm boolean := false;
  r public.fox_launcher_mode_state;
  m text;
  msg text;
  duration integer;
begin
  if u is null and p_op <> 'get' then raise exception 'Требуется вход в аккаунт Fox'; end if;
  if u is not null then select exists(select 1 from public.fox_admins where id=u) into adm; end if;
  insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;

  if p_op = 'set' then
    if not adm then raise exception 'Включать глобальные режимы может только владелец'; end if;
    m := p_data->>'mode';
    msg := btrim(coalesce(p_data->>'message',''));
    duration := (p_data->>'duration_seconds')::integer;
    if m not in ('alarm','ceremony','maintenance','warning','celebration','info') then raise exception 'Неизвестный режим'; end if;
    if duration is null or duration < 5 then raise exception 'Недопустимая длительность'; end if;
    if (m='maintenance' and duration > 86400) or (m<>'maintenance' and duration > 1800) then raise exception 'Недопустимая длительность'; end if;
    if length(msg) < 2 or length(msg) > 240 then raise exception 'Текст должен содержать от 2 до 240 символов'; end if;
    update public.fox_launcher_mode_state
      set mode=m, message=msg, starts_at=now(), ends_at=now()+make_interval(secs=>duration),
          updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'clear' then
    if not adm then raise exception 'Выключать глобальные режимы может только владелец'; end if;
    update public.fox_launcher_mode_state
      set mode=null, message='', starts_at=null, ends_at=null, updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'get' then
    select * into r from public.fox_launcher_mode_state where id=1;
    if r.mode is not null and r.ends_at is not null and r.ends_at <= now() then
      update public.fox_launcher_mode_state
        set mode=null, message='', starts_at=null, ends_at=null, updated_at=now()
        where id=1 returning * into r;
    end if;
  else
    raise exception 'Неизвестная операция';
  end if;

  return jsonb_build_object(
    'mode', r.mode, 'message', r.message, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'updated_at', r.updated_at, 'is_admin', adm,
    'blocked', (r.mode='maintenance' and not adm)
  );
end $$;
revoke all on function public.fox_launcher_mode(text,jsonb) from public, anon;
grant execute on function public.fox_launcher_mode(text,jsonb) to anon, authenticated;


-- =====================================================================
-- Included from backend/migrate-2.7-launcher-mode-scheduling.sql
-- =====================================================================
-- Fox Launcher mode scheduling: exact local dates converted by the client to UTC.
-- Apply once after migrate-2.6-launcher-modes.sql in the Supabase SQL editor.

create or replace function public.fox_launcher_mode(p_op text default 'get', p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := auth.uid();
  adm boolean := false;
  r public.fox_launcher_mode_state;
  m text;
  msg text;
  duration integer;
  scheduled_start timestamptz;
  scheduled_end timestamptz;
begin
  if u is null and p_op <> 'get' then raise exception 'Требуется вход в аккаунт Fox'; end if;
  if u is not null then select exists(select 1 from public.fox_admins where id=u) into adm; end if;
  insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;

  if p_op = 'set' then
    if not adm then raise exception 'Включать глобальные режимы может только владелец'; end if;
    m := p_data->>'mode';
    msg := btrim(coalesce(p_data->>'message',''));
    if m not in ('alarm','ceremony','maintenance','warning','celebration','info') then raise exception 'Неизвестный режим'; end if;
    if length(msg) < 2 or length(msg) > 240 then raise exception 'Текст должен содержать от 2 до 240 символов'; end if;

    if nullif(p_data->>'starts_at','') is not null or nullif(p_data->>'ends_at','') is not null then
      if nullif(p_data->>'starts_at','') is null or nullif(p_data->>'ends_at','') is null then
        raise exception 'Укажите и начало, и конец режима';
      end if;
      scheduled_start := (p_data->>'starts_at')::timestamptz;
      scheduled_end := (p_data->>'ends_at')::timestamptz;
      if scheduled_start <= now() then raise exception 'Для запланированного режима начало должно быть в будущем'; end if;
      if scheduled_end <= scheduled_start then raise exception 'Дата окончания должна быть позже начала'; end if;
      if scheduled_end > scheduled_start + interval '30 days' then raise exception 'Режим нельзя запланировать более чем на 30 дней'; end if;
    else
      duration := (p_data->>'duration_seconds')::integer;
      if duration is null or duration < 5 then raise exception 'Недопустимая длительность'; end if;
      if (m='maintenance' and duration > 86400) or (m<>'maintenance' and duration > 1800) then raise exception 'Недопустимая длительность'; end if;
      scheduled_start := now();
      scheduled_end := now()+make_interval(secs=>duration);
    end if;

    update public.fox_launcher_mode_state
      set mode=m, message=msg, starts_at=scheduled_start, ends_at=scheduled_end,
          updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'clear' then
    if not adm then raise exception 'Выключать глобальные режимы может только владелец'; end if;
    update public.fox_launcher_mode_state
      set mode=null, message='', starts_at=null, ends_at=null, updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'get' then
    select * into r from public.fox_launcher_mode_state where id=1;
    if r.mode is not null and r.ends_at is not null and r.ends_at <= now() then
      update public.fox_launcher_mode_state
        set mode=null, message='', starts_at=null, ends_at=null, updated_at=now()
        where id=1 returning * into r;
    end if;
  else
    raise exception 'Неизвестная операция';
  end if;

  return jsonb_build_object(
    'mode', case when r.starts_at is null or r.starts_at <= now() then r.mode else null end,
    'message', case when r.starts_at is null or r.starts_at <= now() then r.message else '' end,
    'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'scheduled', (r.mode is not null and r.starts_at > now()),
    'updated_at', r.updated_at, 'is_admin', adm,
    'blocked', (r.mode='maintenance' and r.starts_at <= now() and not adm)
  );
end $$;
revoke all on function public.fox_launcher_mode(text,jsonb) from public, anon;
grant execute on function public.fox_launcher_mode(text,jsonb) to anon, authenticated;


-- =====================================================================
-- Included from backend/migrate-2.7-paid-kopeks-admin.sql
-- =====================================================================
-- Fox Launcher 4.0.2: issue owner-granted rubles through the existing paid_kopeks wallet.
-- Apply in Supabase SQL Editor after the existing Fox Launcher migrations.

create or replace function public.fox_owner_grant_paid_rubles(
  p_user uuid,
  p_rubles bigint,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  old_kopeks bigint;
  new_kopeks bigint;
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then
    raise exception 'Доступ только владельцу';
  end if;
  if p_user is null or not exists(select 1 from public.fox_profiles where id=p_user) then
    raise exception 'Игрок не найден';
  end if;
  if exists(select 1 from public.fox_admins where id=p_user) then
    raise exception 'Нельзя выдавать баланс владельцу через эту операцию';
  end if;
  if p_rubles is null or p_rubles < 1 or p_rubles > 1000000 then
    raise exception 'Сумма должна быть от 1 до 1 000 000 рублей';
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 or length(trim(p_reason)) > 200 then
    raise exception 'Причина должна содержать от 3 до 200 символов';
  end if;

  insert into public.fox_wallets(id) values(p_user) on conflict(id) do nothing;
  select paid_kopeks into old_kopeks from public.fox_wallets where id=p_user for update;
  new_kopeks := old_kopeks + p_rubles * 100;
  update public.fox_wallets set paid_kopeks=new_kopeks where id=p_user;
  insert into public.fox_ledger(user_id,actor,currency,amount,reason)
    values(p_user,actor,'paid_kopeks',p_rubles*100,'admin_grant:'||trim(p_reason));
  insert into public.fox_staff_audit(actor,action,data)
    values(actor,'admin_grant_paid_rubles',jsonb_build_object(
      'user',p_user,'rubles',p_rubles,'kopeks_added',p_rubles*100,
      'old_kopeks',old_kopeks,'new_kopeks',new_kopeks,'reason',trim(p_reason)
    ));
  return jsonb_build_object('ok',true,'added_rubles',p_rubles,'added_kopeks',p_rubles*100,'paid_kopeks',new_kopeks);
end;
$$;

create or replace function public.fox_owner_admin_users()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then
    raise exception 'Доступ только владельцу';
  end if;
  insert into public.fox_wallets(id)
    select p.id from public.fox_profiles p
    on conflict(id) do nothing;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb)
    from (
      select p.id,p.nickname,p.created_at,w.foxes,w.pumpkins,w.paid_kopeks
      from public.fox_profiles p
      join public.fox_wallets w on w.id=p.id
      order by p.created_at desc
      limit 500
    ) q
  );
end;
$$;

-- Keep the legacy exact-balance control aligned with the same paid wallet.
create or replace function public.fox_owner_set_rubles(
  p_user uuid,
  p_amount bigint,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  old_kopeks bigint;
  old_rubles bigint;
  delta_rubles bigint;
  delta_kopeks bigint;
  new_kopeks bigint;
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then
    raise exception 'Доступ только владельцу';
  end if;
  if p_user is null or not exists(select 1 from public.fox_profiles where id=p_user) then
    raise exception 'Игрок не найден';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 then
    raise exception 'Баланс должен быть от 0 до 1 000 000 000 рублей';
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 or length(trim(p_reason)) > 200 then
    raise exception 'Причина должна содержать от 3 до 200 символов';
  end if;
  if exists(select 1 from public.fox_admins where id=p_user) then
    raise exception 'Нельзя изменять баланс владельца через эту операцию';
  end if;

  insert into public.fox_wallets(id) values(p_user) on conflict(id) do nothing;
  select paid_kopeks into old_kopeks from public.fox_wallets where id=p_user for update;
  old_rubles := old_kopeks / 100;
  delta_rubles := p_amount - old_rubles;
  new_kopeks := p_amount * 100;
  delta_kopeks := new_kopeks - old_kopeks;
  update public.fox_wallets set paid_kopeks=new_kopeks where id=p_user;
  if delta_kopeks <> 0 then
    insert into public.fox_ledger(user_id,actor,currency,amount,reason)
      values(p_user,actor,'paid_kopeks',delta_kopeks,'admin_set:'||trim(p_reason));
  end if;
  insert into public.fox_staff_audit(actor,action,data)
    values(actor,'admin_set_rubles',jsonb_build_object(
      'user',p_user,'old_amount',old_rubles,'new_amount',p_amount,
      'delta',delta_rubles,'old_kopeks',old_kopeks,'new_kopeks',new_kopeks,
      'reason',trim(p_reason)
    ));
  return jsonb_build_object('ok',true,'old_amount',old_rubles,'new_amount',p_amount,'delta',delta_rubles,'paid_kopeks',new_kopeks);
end;
$$;

revoke all on function public.fox_owner_grant_paid_rubles(uuid,bigint,text) from public,anon;
revoke all on function public.fox_owner_admin_users() from public,anon;
revoke all on function public.fox_owner_set_rubles(uuid,bigint,text) from public,anon;
grant execute on function public.fox_owner_grant_paid_rubles(uuid,bigint,text) to authenticated;
grant execute on function public.fox_owner_admin_users() to authenticated;
grant execute on function public.fox_owner_set_rubles(uuid,bigint,text) to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- Included from backend/migrate-2.8-ticket-archive-cleanup.sql
-- =====================================================================
-- Fox Launcher 4.0.3: ticket archive/deletion, retention and direct-message cleanup.
-- Apply in Supabase SQL Editor after the existing migrations (including 2.0 and 2.6).

alter table public.fox_tickets
  add column if not exists closed_at timestamptz,
  add column if not exists appeal_until timestamptz,
  add column if not exists archived_at timestamptz;

create index if not exists fox_tickets_archive_due
  on public.fox_tickets(archived_at, closed_at)
  where status='closed';

update public.fox_tickets set closed_at=coalesce(closed_at,updated_at),appeal_until=coalesce(appeal_until,updated_at+interval '1 day'),archived_at=coalesce(archived_at,updated_at+interval '1 minute') where status='closed';

create or replace function public.fox_ticket_lifecycle()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='closed' and (tg_op='INSERT' or old.status is distinct from 'closed') then
    new.closed_at := coalesce(new.closed_at,now());
    new.appeal_until := coalesce(new.appeal_until,new.closed_at+interval '1 day');
    new.archived_at := coalesce(new.archived_at,new.closed_at+interval '1 minute');
  elsif new.status='open' then
    new.closed_at := null;
    new.appeal_until := null;
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists fox_ticket_lifecycle_trigger on public.fox_tickets;
create trigger fox_ticket_lifecycle_trigger
before insert or update of status on public.fox_tickets
for each row execute function public.fox_ticket_lifecycle();

-- Called by support views. Open tickets are given two days to be resolved;
-- closed tickets stay available for a one-day appeal window and are archived
-- one minute after closure. Records/messages are purged three days after closure.
create or replace function public.fox_support_cleanup()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare closed_count integer:=0; deleted_count integer:=0; chat_count integer:=0;
begin
  update public.fox_tickets
    set status='closed',closed_at=created_at+interval '2 days',
        appeal_until=created_at+interval '3 days',
        archived_at=created_at+interval '2 days 1 minute',
        updated_at=now()
    where status='open' and created_at<=now()-interval '2 days';
  get diagnostics closed_count=row_count;

  delete from public.fox_tickets
    where status='closed' and created_at<=now()-interval '3 days'
      and appeal_until is not null and appeal_until<=now();
  get diagnostics deleted_count=row_count;

  delete from public.fox_friend_messages where created_at<=now()-interval '3 days';
  get diagnostics chat_count=row_count;

  return jsonb_build_object('closed',closed_count,'deleted_tickets',deleted_count,'deleted_direct_messages',chat_count);
end;
$$;

create or replace function public.fox_support_archive_list()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); staff boolean;
begin
  if u is null then raise exception 'Войди в Fox ID'; end if;
  select exists(select 1 from public.fox_admins where id=u)
    or exists(select 1 from public.fox_roles where user_id=u and role in ('support','support_lead')) into staff;
  if not staff then raise exception 'Архив доступен только команде поддержки'; end if;
  perform public.fox_support_cleanup();
  return (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.archived_at desc),'[]'::jsonb)
    from (
      select t.id,t.title,t.status,t.created_at,t.updated_at,t.closed_at,t.appeal_until,t.archived_at,
        p.nickname,ap.nickname assigned
      from public.fox_tickets t
      join public.fox_profiles p on p.id=t.user_id
      left join public.fox_profiles ap on ap.id=t.assigned
      where t.status='closed' and t.archived_at<=now()
      order by t.archived_at desc limit 500
    ) q
  );
end;
$$;

create or replace function public.fox_support_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); row_data jsonb;
begin
  if u is null or not exists(select 1 from public.fox_admins where id=u) then
    raise exception 'Удалять тикеты может только владелец Fox Launcher';
  end if;
  select jsonb_build_object('id',id,'user_id',user_id,'title',title,'status',status)
    into row_data from public.fox_tickets where id=p_id for update;
  if row_data is null then raise exception 'Тикет не найден'; end if;
  insert into public.fox_staff_audit(actor,action,data)
    values(u,'support_ticket_deleted',row_data);
  delete from public.fox_tickets where id=p_id;
  return jsonb_build_object('ok',true,'deleted',p_id);
end;
$$;

revoke all on function public.fox_ticket_lifecycle() from public,anon,authenticated;
revoke all on function public.fox_support_cleanup() from public,anon;
revoke all on function public.fox_support_archive_list() from public,anon;
revoke all on function public.fox_support_delete(uuid) from public,anon;
grant execute on function public.fox_support_cleanup() to authenticated;
grant execute on function public.fox_support_archive_list() to authenticated;
grant execute on function public.fox_support_delete(uuid) to authenticated;

-- Automatic pg_cron scheduling is intentionally omitted for compatibility with Supabase SQL Editor.
-- fox_support_cleanup() runs when support/archive/chat RPCs are called.


-- =====================================================================
-- Included from backend/migrate-2.9-group-chat.sql
-- =====================================================================
-- Fox Launcher 4.0.3: group conversations for confirmed friends.
-- Apply after backend/migrate-2.0.sql.

create table if not exists public.fox_chat_groups(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 48),
 created_by uuid not null references public.fox_profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.fox_chat_group_members(
 group_id uuid not null references public.fox_chat_groups(id) on delete cascade,
 user_id uuid not null references public.fox_profiles(id) on delete cascade,
 added_by uuid not null references public.fox_profiles(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(group_id,user_id)
);
create table if not exists public.fox_chat_group_messages(
 id bigint generated always as identity primary key,
 group_id uuid not null references public.fox_chat_groups(id) on delete cascade,
 sender uuid not null references public.fox_profiles(id) on delete cascade,
 body text not null check(length(body) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists fox_chat_group_messages_time on public.fox_chat_group_messages(group_id,created_at desc);
alter table public.fox_chat_groups enable row level security;
alter table public.fox_chat_group_members enable row level security;
alter table public.fox_chat_group_messages enable row level security;
revoke all on public.fox_chat_groups from public,anon,authenticated;
revoke all on public.fox_chat_group_members from public,anon,authenticated;
revoke all on public.fox_chat_group_messages from public,anon,authenticated;

create or replace function public.fox_group_chat(p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); gid uuid; target uuid; nm text; msg text; fkey text; result jsonb;
begin
 if u is null then raise exception 'Войди в Fox ID'; end if;
 if p_op='create' then
  nm:=trim(coalesce(p_data->>'name',''));
  if length(nm) not between 2 and 48 then raise exception 'Название группы: 2–48 символов'; end if;
  if jsonb_typeof(p_data->'members') is distinct from 'array' then raise exception 'Выбери хотя бы одного друга'; end if;
  if jsonb_array_length(p_data->'members')<1 or jsonb_array_length(p_data->'members')>20 then raise exception 'В группе может быть от 2 до 21 участника'; end if;
  insert into public.fox_chat_groups(name,created_by) values(nm,u) returning id into gid;
  insert into public.fox_chat_group_members(group_id,user_id,added_by) values(gid,u,u);
  for fkey in select jsonb_array_elements_text(p_data->'members') loop
   select id into target from public.fox_profiles where public_key=nullif(fkey,'')::uuid;
   if target is null or target=u or not public.fox_are_friends(u,target) then raise exception 'В группу можно добавлять только подтверждённых друзей'; end if;
   insert into public.fox_chat_group_members(group_id,user_id,added_by) values(gid,target,u) on conflict do nothing;
  end loop;
  update public.fox_chat_groups set updated_at=now() where id=gid;
  return jsonb_build_object('ok',true,'id',gid);
 elsif p_op='list' then
  return (select coalesce(jsonb_agg(jsonb_build_object(
   'id',g.id,'name',g.name,'created_by',g.created_by,'updated_at',g.updated_at,
   'member_count',(select count(*) from public.fox_chat_group_members gm where gm.group_id=g.id),
   'last_message',(select m.body from public.fox_chat_group_messages m where m.group_id=g.id order by m.created_at desc,m.id desc limit 1)
  ) order by g.updated_at desc),'[]'::jsonb)
  from public.fox_chat_groups g join public.fox_chat_group_members mine on mine.group_id=g.id
  where mine.user_id=u);
 elsif p_op in ('get','send','add') then
  gid:=nullif(p_data->>'id','')::uuid;
  if gid is null or not exists(select 1 from public.fox_chat_group_members where group_id=gid and user_id=u) then raise exception 'Группа не найдена'; end if;
  if p_op='send' then
   msg:=trim(coalesce(p_data->>'body',''));
   if length(msg) not between 1 and 2000 then raise exception 'Сообщение: 1–2000 символов'; end if;
   if (select count(*) from public.fox_chat_group_messages where sender=u and created_at>now()-interval '1 minute')>=30 then raise exception 'Слишком много сообщений. Подожди минуту'; end if;
   insert into public.fox_chat_group_messages(group_id,sender,body) values(gid,u,msg);
   update public.fox_chat_groups set updated_at=now() where id=gid;
   return jsonb_build_object('ok',true);
  elsif p_op='add' then
   if not exists(select 1 from public.fox_chat_groups where id=gid and created_by=u) then raise exception 'Добавлять участников может создатель группы'; end if;
   if jsonb_typeof(p_data->'members') is distinct from 'array' or jsonb_array_length(p_data->'members')<1 then raise exception 'Выбери друзей для добавления'; end if;
   for fkey in select jsonb_array_elements_text(p_data->'members') loop
    select id into target from public.fox_profiles where public_key=nullif(fkey,'')::uuid;
    if target is null or target=u or not public.fox_are_friends(u,target) then raise exception 'Можно добавлять только подтверждённых друзей'; end if;
    insert into public.fox_chat_group_members(group_id,user_id,added_by) values(gid,target,u) on conflict do nothing;
   end loop;
   return jsonb_build_object('ok',true);
  else
   return jsonb_build_object(
    'group',(select jsonb_build_object('id',g.id,'name',g.name,'created_by',g.created_by) from public.fox_chat_groups g where g.id=gid),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'public_key',p.public_key,'nickname',p.nickname) order by p.nickname),'[]'::jsonb) from public.fox_chat_group_members gm join public.fox_profiles p on p.id=gm.user_id where gm.group_id=gid),
    'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender',m.sender,'nickname',p.nickname,'body',m.body,'created_at',m.created_at) order by m.created_at,m.id),'[]'::jsonb) from (select * from public.fox_chat_group_messages where group_id=gid order by created_at desc,id desc limit 100) m join public.fox_profiles p on p.id=m.sender)
   );
  end if;
 else raise exception 'Неизвестная операция группового чата'; end if;
end; $$;

revoke all on function public.fox_group_chat(text,jsonb) from public,anon;
grant execute on function public.fox_group_chat(text,jsonb) to authenticated;

-- Group chat follows the same three-day history retention as direct messages.
create or replace function public.fox_support_cleanup()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare closed_count integer:=0; deleted_count integer:=0; chat_count integer:=0; group_chat_count integer:=0;
begin
 update public.fox_tickets set status='closed',closed_at=created_at+interval '2 days',
  appeal_until=created_at+interval '3 days',archived_at=created_at+interval '2 days 1 minute',updated_at=now()
  where status='open' and created_at<=now()-interval '2 days';
 get diagnostics closed_count=row_count;
 delete from public.fox_tickets where status='closed' and created_at<=now()-interval '3 days' and appeal_until is not null and appeal_until<=now();
 get diagnostics deleted_count=row_count;
 delete from public.fox_friend_messages where created_at<=now()-interval '3 days';
 get diagnostics chat_count=row_count;
 delete from public.fox_chat_group_messages where created_at<=now()-interval '3 days';
 get diagnostics group_chat_count=row_count;
 return jsonb_build_object('closed',closed_count,'deleted_tickets',deleted_count,'deleted_direct_messages',chat_count,'deleted_group_messages',group_chat_count);
end; $$;


-- =====================================================================
-- Included from backend/migrate-3.0-group-calls.sql
-- =====================================================================
-- Fox Launcher 4.0.3: multi-party WebRTC signaling for friend-group voice/video calls.
-- Apply after backend/migrate-2.9-group-chat.sql.

create table if not exists public.fox_group_calls(
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.fox_chat_groups(id) on delete cascade,
 started_by uuid not null references public.fox_profiles(id) on delete cascade,
 status text not null default 'active' check(status in ('active','ended')),
 created_at timestamptz not null default now(),
 ended_at timestamptz
);
create index if not exists fox_group_calls_active on public.fox_group_calls(group_id,status,created_at desc);
create table if not exists public.fox_group_call_participants(
 call_id uuid not null references public.fox_group_calls(id) on delete cascade,
 user_id uuid not null references public.fox_profiles(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(call_id,user_id)
);
create table if not exists public.fox_group_call_signals(
 id bigint generated always as identity primary key,
 call_id uuid not null references public.fox_group_calls(id) on delete cascade,
 sender uuid not null references public.fox_profiles(id) on delete cascade,
 recipient uuid not null references public.fox_profiles(id) on delete cascade,
 kind text not null check(kind in ('offer','answer','ice','hangup')),
 payload jsonb,
 created_at timestamptz not null default now(),
 check(sender<>recipient)
);
create index if not exists fox_group_call_signal_inbox on public.fox_group_call_signals(recipient,id);
alter table public.fox_group_calls enable row level security;
alter table public.fox_group_call_participants enable row level security;
alter table public.fox_group_call_signals enable row level security;
revoke all on public.fox_group_calls from public,anon,authenticated;
revoke all on public.fox_group_call_participants from public,anon,authenticated;
revoke all on public.fox_group_call_signals from public,anon,authenticated;

create or replace function public.fox_group_call_signal(p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); gid uuid; cid uuid; target uuid; c public.fox_group_calls%rowtype; k text; payload jsonb; since_id bigint;
begin
 if u is null then raise exception 'Войди в Fox ID'; end if;
 if p_op='start' then
  gid:=nullif(p_data->>'group_id','')::uuid;
  if gid is null or not exists(select 1 from public.fox_chat_group_members where group_id=gid and user_id=u) then raise exception 'Группа не найдена'; end if;
  if exists(select 1 from public.fox_group_calls where group_id=gid and status='active' and created_at>now()-interval '2 hours') then raise exception 'В группе уже идёт звонок'; end if;
  insert into public.fox_group_calls(group_id,started_by) values(gid,u) returning * into c;
  insert into public.fox_group_call_participants(call_id,user_id) values(c.id,u);
  return jsonb_build_object('id',c.id,'group_id',gid,'status','active','started_by',u);
 elsif p_op='active' then
  gid:=nullif(p_data->>'group_id','')::uuid;
  if gid is null or not exists(select 1 from public.fox_chat_group_members where group_id=gid and user_id=u) then raise exception 'Группа не найдена'; end if;
  return coalesce((select jsonb_build_object('id',c.id,'group_id',c.group_id,'status',c.status,'started_by',c.started_by,'created_at',c.created_at,
    'participants',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname) order by p.nickname),'[]'::jsonb)
      from public.fox_group_call_participants cp join public.fox_profiles p on p.id=cp.user_id where cp.call_id=c.id))
    from public.fox_group_calls c where c.group_id=gid and c.status='active' and c.created_at>now()-interval '2 hours' order by c.created_at desc limit 1),'{}'::jsonb);
 elsif p_op='join' then
  cid:=nullif(p_data->>'id','')::uuid;
  select * into c from public.fox_group_calls where id=cid and status='active' for update;
  if not found or not exists(select 1 from public.fox_chat_group_members where group_id=c.group_id and user_id=u) then raise exception 'Активный групповой звонок не найден'; end if;
  if not exists(select 1 from public.fox_group_call_participants where call_id=cid and user_id=u) then
   if (select count(*) from public.fox_group_call_participants where call_id=cid)>=6 then raise exception 'В звонке максимум 6 участников'; end if;
   insert into public.fox_group_call_participants(call_id,user_id) values(cid,u);
  end if;
  return jsonb_build_object('ok',true,'id',cid);
 elsif p_op='poll' then
  cid:=nullif(p_data->>'id','')::uuid; since_id:=coalesce(nullif(p_data->>'since_id','')::bigint,0);
  if not exists(select 1 from public.fox_group_call_participants where call_id=cid and user_id=u)
    or not exists(select 1 from public.fox_group_calls where id=cid and status='active') then
    return jsonb_build_object('status','ended','participants','[]'::jsonb,'signals','[]'::jsonb,'last_id',since_id);
  end if;
  return jsonb_build_object(
   'status','active',
   'participants',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname) order by p.nickname),'[]'::jsonb)
     from public.fox_group_call_participants cp join public.fox_profiles p on p.id=cp.user_id where cp.call_id=cid),
   'signals',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'sender',s.sender,'kind',s.kind,'payload',s.payload) order by s.id),'[]'::jsonb)
     from public.fox_group_call_signals s where s.call_id=cid and s.recipient=u and s.id>since_id),
   'last_id',coalesce((select max(s.id) from public.fox_group_call_signals s where s.call_id=cid and s.recipient=u),since_id)
  );
 elsif p_op='signal' then
  cid:=nullif(p_data->>'id','')::uuid; target:=nullif(p_data->>'recipient','')::uuid;k:=p_data->>'kind';payload:=p_data->'payload';
  if k not in ('offer','answer','ice','hangup') then raise exception 'Неизвестный тип сигнала'; end if;
  if not exists(select 1 from public.fox_group_call_participants where call_id=cid and user_id=u)
   or not exists(select 1 from public.fox_group_call_participants where call_id=cid and user_id=target)
   or not exists(select 1 from public.fox_group_calls where id=cid and status='active') then raise exception 'Участник звонка не найден'; end if;
  if payload is not null and length(payload::text)>100000 then raise exception 'Слишком большой сигнал'; end if;
  insert into public.fox_group_call_signals(call_id,sender,recipient,kind,payload) values(cid,u,target,k,payload);
  return jsonb_build_object('ok',true);
 elsif p_op='leave' then
  cid:=nullif(p_data->>'id','')::uuid;
  if not exists(select 1 from public.fox_group_call_participants where call_id=cid and user_id=u) then return jsonb_build_object('ok',true); end if;
  for target in select user_id from public.fox_group_call_participants where call_id=cid and user_id<>u loop
    insert into public.fox_group_call_signals(call_id,sender,recipient,kind) values(cid,u,target,'hangup');
  end loop;
  delete from public.fox_group_call_participants where call_id=cid and user_id=u;
  if not exists(select 1 from public.fox_group_call_participants where call_id=cid) or exists(select 1 from public.fox_group_calls where id=cid and started_by=u) then
    update public.fox_group_calls set status='ended',ended_at=now() where id=cid;
  end if;
  return jsonb_build_object('ok',true);
 else raise exception 'Неизвестная операция группового звонка'; end if;
end; $$;

revoke all on function public.fox_group_call_signal(text,jsonb) from public,anon;
grant execute on function public.fox_group_call_signal(text,jsonb) to authenticated;


-- =====================================================================
-- Included from backend/migrate-4.0.0-hotfix.sql
-- =====================================================================
-- Fox Launcher 4.0.3 hotfix: ensure the owner admin-users RPC exists and PostgREST sees it.
-- Apply in Supabase SQL Editor if the launcher reports PGRST202 for fox_owner_admin_users.

create or replace function public.fox_owner_admin_users()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then
    raise exception 'Доступ только владельцу';
  end if;
  insert into public.fox_wallets(id)
    select p.id from public.fox_profiles p
    on conflict(id) do nothing;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb)
    from (
      select p.id,p.nickname,p.created_at,w.foxes,w.pumpkins,w.paid_kopeks
      from public.fox_profiles p
      join public.fox_wallets w on w.id=p.id
      order by p.created_at desc
      limit 500
    ) q
  );
end;
$$;
revoke all on function public.fox_owner_admin_users() from public,anon;
grant execute on function public.fox_owner_admin_users() to authenticated;

-- Fox Launcher 5.0: self-service reset of gameplay progress and virtual balances.
-- Keeps the Fox ID, purchased items/subscriptions, and paid_kopeks untouched.
create or replace function public.fox_reset_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fox_reset$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Сначала войди в Fox ID'; end if;
  if not exists(select 1 from public.fox_profiles where id=u) then
    raise exception 'Профиль Fox не найден';
  end if;

  delete from public.fox_sessions where user_id=u;
  delete from public.fox_progress where user_id=u;
  delete from public.fox_achievements where user_id=u;
  delete from public.fox_daily_rewards where user_id=u;
  delete from public.fox_daily_play where user_id=u;
  delete from public.fox_quest_claims where user_id=u;
  update public.fox_wallets set foxes=0, pumpkins=0 where id=u;

  return jsonb_build_object('ok',true,'reset_at',now());
end;
$fox_reset$;
revoke all on function public.fox_reset_account() from public, anon;
grant execute on function public.fox_reset_account() to authenticated;

-- Fox Launcher 5.0 server directory with owner-managed expiry.
create table if not exists public.fox_server_catalog (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 80),
 address text not null check(length(trim(address)) between 3 and 180),
 version text not null default '',
 description text not null default '',
 website text not null default '',
 created_by uuid not null references auth.users(id),
 starts_at timestamptz not null default now(),
 ends_at timestamptz not null,
 created_at timestamptz not null default now(),
 removed_at timestamptz,
 check(ends_at>starts_at)
);
create index if not exists fox_server_catalog_active_idx on public.fox_server_catalog(ends_at) where removed_at is null;
alter table public.fox_server_catalog enable row level security;
revoke all on public.fox_server_catalog from public,anon,authenticated;

create or replace function public.fox_server_catalog(p_op text default 'list',p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fox_servers$
declare u uuid:=auth.uid(); row_data public.fox_server_catalog; hours integer;
begin
 if p_op='list' then
   return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
     from (select id,name,address,version,description,website,starts_at,ends_at,created_at
       from public.fox_server_catalog where removed_at is null and starts_at<=now() and ends_at>now()
       order by created_at desc) x);
 end if;
 if u is null or not exists(select 1 from public.fox_admins where id=u) then
   raise exception 'Добавлять и изменять серверы может только владелец Fox';
 end if;
 if p_op='add' then
   hours:=nullif(p_data->>'duration_hours','')::integer;
   if hours is null or hours not in (1,24,72,168,720) then raise exception 'Выбери срок: 1, 24, 72, 168 или 720 часов'; end if;
   if length(trim(coalesce(p_data->>'name','')))<2 or length(trim(coalesce(p_data->>'address','')))<3 then raise exception 'Укажи название и адрес сервера'; end if;
   if length(coalesce(p_data->>'description',''))>1000 or length(coalesce(p_data->>'website',''))>240 then raise exception 'Описание или ссылка слишком длинные'; end if;
   insert into public.fox_server_catalog(name,address,version,description,website,created_by,starts_at,ends_at)
   values(trim(p_data->>'name'),trim(p_data->>'address'),left(coalesce(p_data->>'version',''),40),coalesce(p_data->>'description',''),coalesce(p_data->>'website',''),u,now(),now()+make_interval(hours=>hours))
   returning * into row_data;
   insert into public.fox_staff_audit(actor,action,data) values(u,'server_catalog_add',jsonb_build_object('server_id',row_data.id,'name',row_data.name,'ends_at',row_data.ends_at));
   return jsonb_build_object('ok',true,'id',row_data.id,'starts_at',row_data.starts_at,'ends_at',row_data.ends_at);
 elsif p_op='remove' then
   update public.fox_server_catalog set removed_at=now() where id=(p_data->>'id')::uuid and removed_at is null returning * into row_data;
   if row_data.id is null then raise exception 'Активный сервер не найден'; end if;
   insert into public.fox_staff_audit(actor,action,data) values(u,'server_catalog_remove',jsonb_build_object('server_id',row_data.id,'name',row_data.name));
   return jsonb_build_object('ok',true);
 elsif p_op='admin_list' then
   return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
    from (select id,name,address,version,description,website,starts_at,ends_at from public.fox_server_catalog where ends_at>now() and removed_at is null order by created_at desc) x);
 else raise exception 'Неизвестная операция каталога серверов'; end if;
end;
$fox_servers$;
revoke all on function public.fox_server_catalog(text,jsonb) from public,anon;
grant execute on function public.fox_server_catalog(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
