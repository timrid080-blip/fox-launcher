-- Fox Launcher 2.2: secure WebRTC call signaling between existing friends.
-- Apply AFTER migrate-2.1.sql. Back up Supabase first.
begin;
create table if not exists public.fox_calls (
 id uuid primary key default gen_random_uuid(),
 caller uuid not null references public.fox_profiles(id) on delete cascade,
 callee uuid not null references public.fox_profiles(id) on delete cascade,
 status text not null default 'ringing' check(status in ('ringing','accepted','ended')),
 offer jsonb,
 answer jsonb,
 caller_ice jsonb not null default '[]'::jsonb,
 callee_ice jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint fox_calls_not_self check(caller<>callee)
);
create index if not exists fox_calls_callee_status on public.fox_calls(callee,status,created_at desc);
create index if not exists fox_calls_caller_status on public.fox_calls(caller,status,created_at desc);
alter table public.fox_calls enable row level security;
revoke all on public.fox_calls from public,anon,authenticated;

create or replace function public.fox_call_signal(p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; cid uuid; c public.fox_calls%rowtype; payload jsonb;
begin
 if u is null then raise exception 'Войди в Fox ID'; end if;
 if p_op='start' then
   select id into target from public.fox_profiles where public_key=nullif(p_data->>'friend','')::uuid;
   if target is null or target=u or not public.fox_are_friends(u,target) then raise exception 'Звонить можно только друзьям'; end if;
   if exists(select 1 from public.fox_calls where (status='accepted' or (status='ringing' and created_at>now()-interval '2 minutes')) and (caller=u or callee=u or caller=target or callee=target)) then raise exception 'У одного из игроков уже есть активный звонок'; end if;
   insert into public.fox_calls(caller,callee) values(u,target) returning * into c;
   return jsonb_build_object('id',c.id,'status',c.status,'caller',c.caller,'callee',c.callee,'caller_nickname',(select nickname from public.fox_profiles where id=c.caller),'callee_nickname',(select nickname from public.fox_profiles where id=c.callee),'created_at',c.created_at);
 elsif p_op='poll' then
   return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'caller',x.caller,'callee',x.callee,'status',x.status,'offer',x.offer,'answer',x.answer,'caller_ice',x.caller_ice,'callee_ice',x.callee_ice,'caller_nickname',(select nickname from public.fox_profiles where id=x.caller),'callee_nickname',(select nickname from public.fox_profiles where id=x.callee),'updated_at',x.updated_at) order by x.created_at desc)
     from public.fox_calls x where (x.caller=u or x.callee=u) and (x.status='accepted' or (x.status='ringing' and x.created_at>now()-interval '2 minutes'))), '[]'::jsonb);
 else
   cid:=nullif(p_data->>'id','')::uuid;
   select * into c from public.fox_calls where id=cid and (caller=u or callee=u) for update;
   if not found then raise exception 'Звонок не найден или недоступен'; end if;
   if p_op='offer' then
     if c.caller<>u or c.status<>'ringing' then raise exception 'Нельзя отправить предложение звонка'; end if;
     payload:=p_data->'value'; if payload is null or length(payload::text)>100000 then raise exception 'Некорректное SDP-предложение'; end if;
     update public.fox_calls set offer=payload,updated_at=now() where id=cid;
   elsif p_op='answer' then
     if c.callee<>u or c.status not in ('ringing','accepted') then raise exception 'Нельзя принять этот звонок'; end if;
     payload:=p_data->'value'; if payload is null or length(payload::text)>100000 then raise exception 'Некорректный SDP-ответ'; end if;
     update public.fox_calls set answer=payload,status='accepted',updated_at=now() where id=cid;
   elsif p_op='ice' then
     payload:=p_data->'value'; if payload is null or length(payload::text)>10000 then raise exception 'Некорректный ICE-кандидат'; end if;
     if p_data->>'side'='caller' and c.caller=u then update public.fox_calls set caller_ice=caller_ice||jsonb_build_array(payload),updated_at=now() where id=cid;
     elsif p_data->>'side'='callee' and c.callee=u then update public.fox_calls set callee_ice=callee_ice||jsonb_build_array(payload),updated_at=now() where id=cid;
     else raise exception 'Недопустимая сторона звонка'; end if;
   elsif p_op='end' then
     update public.fox_calls set status='ended',updated_at=now() where id=cid;
   else raise exception 'Неизвестная операция звонка'; end if;
   return jsonb_build_object('ok',true);
 end if;
end; $$;
revoke all on function public.fox_call_signal(text,jsonb) from public,anon;
grant execute on function public.fox_call_signal(text,jsonb) to authenticated;
commit;
