-- Owner-only operations for the internal ruble wallet.
-- The UI passes whole rubles; fox_wallets.rubles is stored in kopeks.
-- Allows the owner to edit their own wallet, while keeping the action audited.
begin;
drop function if exists public.fox_owner_set_rubles(uuid, numeric, text);
drop function if exists public.fox_owner_set_rubles(uuid, bigint, text);
drop function if exists public.fox_owner_grant_rubles(uuid, numeric, text);
drop function if exists public.fox_owner_grant_rubles(uuid, bigint, text);

create function public.fox_owner_set_rubles(p_user uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  old_amount bigint := 0;
  new_amount bigint;
  delta bigint;
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
  new_amount := round(p_amount * 100)::bigint;
  insert into public.fox_wallets(id) values(p_user) on conflict(id) do nothing;
  select rubles into old_amount from public.fox_wallets where id=p_user for update;
  delta := new_amount - old_amount;
  update public.fox_wallets set rubles=new_amount where id=p_user;
  if delta <> 0 then
    insert into public.fox_ledger(user_id,currency,amount,reason)
      values(p_user,'rubles',delta,'admin_set:'||trim(p_reason));
  end if;
  insert into public.fox_staff_audit(actor,action,data)
    values(actor,'admin_set_rubles',jsonb_build_object(
      'user',p_user,'old_amount_kopeks',old_amount,'new_amount_kopeks',new_amount,
      'delta_kopeks',delta,'reason',trim(p_reason)
    ));
  return jsonb_build_object('ok',true,'old_amount_kopeks',old_amount,'new_amount_kopeks',new_amount,'delta_kopeks',delta);
end;
$$;

create function public.fox_owner_grant_rubles(p_user uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  n bigint;
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then
    raise exception 'Доступ только владельцу';
  end if;
  if p_user is null or not exists(select 1 from public.fox_profiles where id=p_user) then
    raise exception 'Игрок не найден';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'Сумма должна быть от 1 до 1 000 000 рублей';
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 or length(trim(p_reason)) > 200 then
    raise exception 'Причина должна содержать от 3 до 200 символов';
  end if;
  n := round(p_amount * 100)::bigint;
  insert into public.fox_wallets(id,rubles) values(p_user,n)
    on conflict(id) do update set rubles=public.fox_wallets.rubles+excluded.rubles;
  insert into public.fox_ledger(user_id,actor,currency,amount,reason)
    values(p_user,actor,'rubles',n,'Выдача учётных рублей: '||trim(p_reason));
  insert into public.fox_staff_audit(actor,action,data)
    values(actor,'admin_grant_rubles',jsonb_build_object('user',p_user,'amount_kopeks',n,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'user',p_user,'credited_kopeks',n);
end;
$$;

revoke all on function public.fox_owner_set_rubles(uuid,numeric,text) from public, anon;
revoke all on function public.fox_owner_grant_rubles(uuid,numeric,text) from public, anon;
grant execute on function public.fox_owner_set_rubles(uuid,numeric,text) to authenticated;
grant execute on function public.fox_owner_grant_rubles(uuid,numeric,text) to authenticated;
commit;
