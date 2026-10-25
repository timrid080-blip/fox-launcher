-- Fox Launcher 2.1: return the refreshed wallet after daily rewards. Apply after migrate-2.0.sql.
begin;
do $$ begin
 if to_regprocedure('public.fox_action_v140(text,jsonb)') is null then raise exception 'Apply backend/migrate-1.5.sql and earlier Fox Club migrations first'; end if;
 if to_regprocedure('public.fox_action_v200(text,jsonb)') is null then
  if to_regprocedure('public.fox_action(text,jsonb)') is null then raise exception 'public.fox_action is missing; apply migrations 1.2 through 2.0 in order'; end if;
  alter function public.fox_action(text,jsonb) rename to fox_action_v200;
 end if;
end $$;
revoke all on function public.fox_action_v200(text,jsonb) from public,anon,authenticated;
create or replace function public.fox_action(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 r:=public.fox_action_v200(p_action,p_data);
 if p_action='daily_claim' then
  r:=public.fox_action_v200('state','{}'::jsonb);
 end if;
 return r;
end; $$;
revoke all on function public.fox_action(text,jsonb) from public,anon;
grant execute on function public.fox_action(text,jsonb) to authenticated;
commit;
