-- Owner-only operations for the account's internal ruble wallet.
-- These are account credits, not real-money payments.
begin;

create or replace function public.fox_owner_set_rubles(p_user uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := auth.uid();
  old_amount bigint := 0;
  new_amount bigint;
begin
  if u is null or not exists(select 1 from public.fox_admins where id=u) then
    raise exception 'Доступ только владельцу';
  end if;
  if p_user is null or p_amount is null or p_amount < 0 or p_amount > 1000000000 then
    raise exception 'Баланс должен быть от 0 до 1 000 000 000 ₽';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 200 then
    raise exception 'Укажи причину длиной от 3 до 200 символов';
  end if;
  if not exists(select 1 from public.fox_profiles where id=p_user) then
    raise exception 'Пользователь ещё не вошёл в Fox Launcher';
  end if;
  new_amount := round(p_amount * 100)::bigint;
  insert into public.fox_wallets(id,rubles) values(p_user,0) on conflict(id) do nothing;
  select rubles into old_amount from public.fox_wallets where id=p_user for update;
  update public.fox_wallets set rubles=new_amount where id=p_user;
  insert into public.fox_ledger(user_id,actor,currency,amount,reason)
    values(p_user,u,'rubles',new_amount-old_amount,'Установка точного баланса: '||btrim(p_reason));
  return jsonb_build_object('user',p_user,'previous_kopeks',old_amount,'balance_kopeks',new_amount);
end $$;

create or replace function public.fox_owner_grant_rubles(p_user uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := auth.uid();
  n bigint;
begin
  if u is null or not exists(select 1 from public.fox_admins where id=u) then
    raise exception 'Доступ только владельцу';
  end if;
  if p_user is null or p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'Сумма должна быть от 1 до 1 000 000 ₽';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 200 then
    raise exception 'Укажи причину длиной от 3 до 200 символов';
  end if;
  if not exists(select 1 from public.fox_profiles where id=p_user) then
    raise exception 'Пользователь ещё не вошёл в Fox Launcher';
  end if;
  n := round(p_amount * 100)::bigint;
  insert into public.fox_wallets(id,rubles) values(p_user,n)
    on conflict(id) do update set rubles=public.fox_wallets.rubles+excluded.rubles;
  insert into public.fox_ledger(user_id,actor,currency,amount,reason)
    values(p_user,u,'rubles',n,'Выдача учётных рублей: '||btrim(p_reason));
  return jsonb_build_object('user',p_user,'credited_kopeks',n);
end $$;

revoke all on function public.fox_owner_set_rubles(uuid,numeric,text) from public, anon;
revoke all on function public.fox_owner_grant_rubles(uuid,numeric,text) from public, anon;
grant execute on function public.fox_owner_set_rubles(uuid,numeric,text) to authenticated;
grant execute on function public.fox_owner_grant_rubles(uuid,numeric,text) to authenticated;
commit;
