-- Fox Launcher 4.0.0 hotfix: owner wallet RPCs and self-balance support.
-- Apply in Supabase SQL Editor after the existing Fox Launcher migrations.
begin;

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
  if exists(select 1 from public.fox_admins where id=p_user) and p_user <> actor then
    raise exception 'Нельзя изменять баланс другого администратора';
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
  if exists(select 1 from public.fox_admins where id=p_user) and p_user <> actor then
    raise exception 'Нельзя изменять баланс другого администратора';
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

commit;

notify pgrst, 'reload schema';
