-- Fox Launcher presence v1. Apply in Supabase SQL Editor after migrate-2.4.sql.
begin;
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
commit;
