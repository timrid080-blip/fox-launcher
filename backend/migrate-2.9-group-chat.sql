-- Fox Launcher 4.0.3: group conversations for confirmed friends.
-- Apply after backend/migrate-2.0.sql.
begin;

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

commit;
