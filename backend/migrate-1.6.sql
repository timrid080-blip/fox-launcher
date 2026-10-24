-- Fox Launcher 1.6: apply AFTER migrate-1.5.sql. Back up first.
-- Adds owner-only exact editing of the legacy accounting-ruble wallet.
-- This is not the paid_kopeks balance and does not simulate a payment.
begin;

create or replace function public.fox_owner_set_rubles(
  p_user uuid,
  p_amount bigint,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid := auth.uid();
  old_amount bigint;
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
  if exists(select 1 from public.fox_admins where id=p_user) then
    raise exception 'Нельзя изменять баланс владельца через эту операцию';
  end if;

  insert into public.fox_wallets(id) values(p_user) on conflict(id) do nothing;
  select rubles into old_amount from public.fox_wallets where id=p_user for update;
  delta := p_amount - old_amount;
  update public.fox_wallets set rubles=p_amount where id=p_user;
  if delta <> 0 then
    insert into public.fox_ledger(user_id,currency,amount,reason)
    values(p_user,'rubles',delta,'admin_set:'||trim(p_reason));
  end if;
  insert into public.fox_staff_audit(actor,action,data)
  values(actor,'admin_set_rubles',jsonb_build_object(
    'user',p_user,'old_amount',old_amount,'new_amount',p_amount,
    'delta',delta,'reason',trim(p_reason)
  ));
  return jsonb_build_object('ok',true,'old_amount',old_amount,'new_amount',p_amount,'delta',delta);
end;
$$;

revoke all on function public.fox_owner_set_rubles(uuid,bigint,text) from public,anon;
grant execute on function public.fox_owner_set_rubles(uuid,bigint,text) to authenticated;

commit;
