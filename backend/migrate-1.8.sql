-- Fox Launcher 1.8: allow owner self-balance changes, grant legacy accounting rubles, global announcements.
-- Apply AFTER migrations 1.2 through 1.7. Back up the database first.
begin;

create or replace function public.fox_owner_set_rubles(
  p_user uuid, p_amount bigint, p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old_amount bigint; delta bigint;
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then raise exception 'Доступ только владельцу'; end if;
  if p_user is null or not exists(select 1 from public.fox_profiles where id=p_user) then raise exception 'Игрок не найден'; end if;
  if p_amount is null or p_amount<0 or p_amount>1000000000 then raise exception 'Баланс должен быть от 0 до 1 000 000 000'; end if;
  if length(trim(coalesce(p_reason,'')))<3 or length(trim(p_reason))>200 then raise exception 'Причина должна содержать от 3 до 200 символов'; end if;
  insert into public.fox_wallets(id) values(p_user) on conflict(id) do nothing;
  select rubles into old_amount from public.fox_wallets where id=p_user for update;
  delta:=p_amount-old_amount;
  update public.fox_wallets set rubles=p_amount where id=p_user;
  if delta<>0 then insert into public.fox_ledger(user_id,currency,amount,reason) values(p_user,'rubles',delta,'admin_set:'||trim(p_reason)); end if;
  insert into public.fox_staff_audit(actor,action,data) values(actor,'admin_set_rubles',jsonb_build_object('user',p_user,'old_amount',old_amount,'new_amount',p_amount,'delta',delta,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'old_amount',old_amount,'new_amount',p_amount,'delta',delta);
end; $$;

create or replace function public.fox_owner_grant_rubles(
  p_user uuid, p_amount bigint, p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); new_amount bigint;
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then raise exception 'Доступ только владельцу'; end if;
  if p_user is null or not exists(select 1 from public.fox_profiles where id=p_user) then raise exception 'Игрок не найден'; end if;
  if p_amount is null or p_amount<1 or p_amount>1000000000 then raise exception 'Сумма должна быть от 1 до 1 000 000 000'; end if;
  if length(trim(coalesce(p_reason,'')))<3 or length(trim(p_reason))>200 then raise exception 'Укажи причину длиной 3–200 символов'; end if;
  insert into public.fox_wallets(id) values(p_user) on conflict(id) do nothing;
  update public.fox_wallets set rubles=rubles+p_amount where id=p_user returning rubles into new_amount;
  insert into public.fox_ledger(user_id,currency,amount,reason) values(p_user,'rubles',p_amount,'admin_grant:'||trim(p_reason));
  insert into public.fox_staff_audit(actor,action,data) values(actor,'admin_grant_rubles',jsonb_build_object('user',p_user,'amount',p_amount,'new_amount',new_amount,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'new_amount',new_amount,'granted',p_amount);
end; $$;

create or replace function public.fox_owner_broadcast(p_title text,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sent_count bigint;
begin
  if actor is null or not exists(select 1 from public.fox_admins where id=actor) then raise exception 'Доступ только владельцу'; end if;
  if length(trim(coalesce(p_title,'')))<2 or length(trim(p_title))>80 then raise exception 'Заголовок должен содержать 2–80 символов'; end if;
  if length(trim(coalesce(p_body,'')))<2 or length(trim(p_body))>500 then raise exception 'Текст должен содержать 2–500 символов'; end if;
  insert into public.fox_notifications(user_id,title,body,kind)
  select p.id,trim(p_title),trim(p_body),'announcement' from public.fox_profiles p;
  get diagnostics sent_count = row_count;
  insert into public.fox_staff_audit(actor,action,data) values(actor,'global_announcement',jsonb_build_object('title',trim(p_title),'body',trim(p_body),'recipients',sent_count));
  return jsonb_build_object('ok',true,'recipients',sent_count);
end; $$;

revoke all on function public.fox_owner_set_rubles(uuid,bigint,text) from public,anon;
revoke all on function public.fox_owner_grant_rubles(uuid,bigint,text) from public,anon;
revoke all on function public.fox_owner_broadcast(text,text) from public,anon;
grant execute on function public.fox_owner_set_rubles(uuid,bigint,text) to authenticated;
grant execute on function public.fox_owner_grant_rubles(uuid,bigint,text) to authenticated;
grant execute on function public.fox_owner_broadcast(text,text) to authenticated;
commit;
