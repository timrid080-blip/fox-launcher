-- Fox Launcher 2.0: private friend chat foundation. Apply after migrate-1.9.sql.
begin;
create table if not exists public.fox_friend_messages (
 id bigint generated always as identity primary key,
 sender uuid not null references public.fox_profiles(id) on delete cascade,
 recipient uuid not null references public.fox_profiles(id) on delete cascade,
 body text not null check(length(body) between 1 and 2000),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 constraint fox_friend_message_not_self check(sender<>recipient)
);
create index if not exists fox_friend_messages_pair_time on public.fox_friend_messages(sender,recipient,created_at desc);
create index if not exists fox_friend_messages_recipient_time on public.fox_friend_messages(recipient,created_at desc);
alter table public.fox_friend_messages enable row level security;
revoke all on public.fox_friend_messages from public,anon,authenticated;
create or replace function public.fox_friend_chat(p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; msg text; mid bigint;
begin
 if u is null then raise exception 'Войди в Fox ID'; end if;
 if p_op='list' then
   select id into target from public.fox_profiles where public_key=nullif(p_data->>'friend','')::uuid;
   if target is null or not public.fox_are_friends(u,target) then raise exception 'Чат доступен только друзьям'; end if;
   update public.fox_friend_messages set read_at=now() where sender=target and recipient=u and read_at is null;
   return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'body',m.body,'created_at',m.created_at,'read_at',m.read_at) order by m.created_at,m.id),'[]'::jsonb)
     from (select * from public.fox_friend_messages where (sender=u and recipient=target) or (sender=target and recipient=u) order by created_at desc,id desc limit 100) m);
 elsif p_op='send' then
   select id into target from public.fox_profiles where public_key=nullif(p_data->>'friend','')::uuid; msg:=trim(coalesce(p_data->>'body',''));
   if target is null or target=u or not public.fox_are_friends(u,target) then raise exception 'Чат доступен только друзьям'; end if;
   if length(msg)<1 or length(msg)>2000 then raise exception 'Сообщение: 1–2000 символов'; end if;
   if (select count(*) from public.fox_friend_messages where sender=u and created_at>now()-interval '1 minute')>=20 then raise exception 'Слишком много сообщений. Подожди минуту'; end if;
   if (select count(*) from public.fox_friend_messages where sender=u and recipient=target and created_at>now()-interval '1 day')>=500 then raise exception 'Достигнут дневной лимит сообщений этому другу'; end if;
   insert into public.fox_friend_messages(sender,recipient,body) values(u,target,msg) returning id into mid;
   return jsonb_build_object('ok',true,'id',mid);
 else raise exception 'Неизвестная операция чата'; end if;
end; $$;
revoke all on function public.fox_friend_chat(text,jsonb) from public,anon;
grant execute on function public.fox_friend_chat(text,jsonb) to authenticated;
commit;
