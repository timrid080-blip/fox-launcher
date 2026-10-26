-- Fox Launcher 4.0.3: multi-party WebRTC signaling for friend-group voice/video calls.
-- Apply after backend/migrate-2.9-group-chat.sql.
begin;

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
commit;
