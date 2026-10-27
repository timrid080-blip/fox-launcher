-- Fox Launcher 4.0.3 hotfix: ensure the owner admin-users RPC exists and PostgREST sees it.
-- Apply in Supabase SQL Editor if the launcher reports PGRST202 for fox_owner_admin_users.
begin;
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
commit;
notify pgrst, 'reload schema';
