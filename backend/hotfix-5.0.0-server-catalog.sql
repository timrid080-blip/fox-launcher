-- Hotfix: fox_server_catalog admin_list must select created_at before ordering by it.
begin;
create or replace function public.fox_server_catalog(p_op text default 'list',p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); row_data public.fox_server_catalog; hours integer;
begin
 if p_op='list' then
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
   from (select id,name,address,version,description,website,starts_at,ends_at,created_at from public.fox_server_catalog where removed_at is null and starts_at<=now() and ends_at>now() order by created_at desc) x);
 end if;
 if u is null or not exists(select 1 from public.fox_admins where id=u) then raise exception 'Добавлять и изменять серверы может только владелец Fox'; end if;
 if p_op='add' then
  hours:=nullif(p_data->>'duration_hours','')::integer;
  if hours is null or hours not in (1,24,72,168,720) then raise exception 'Выбери срок: 1, 24, 72, 168 или 720 часов'; end if;
  if length(trim(coalesce(p_data->>'name','')))<2 or length(trim(coalesce(p_data->>'address','')))<3 then raise exception 'Укажи название и адрес сервера'; end if;
  if length(coalesce(p_data->>'description',''))>1000 or length(coalesce(p_data->>'website',''))>240 then raise exception 'Описание или ссылка слишком длинные'; end if;
  insert into public.fox_server_catalog(name,address,version,description,website,created_by,starts_at,ends_at)
  values(trim(p_data->>'name'),trim(p_data->>'address'),left(coalesce(p_data->>'version',''),40),coalesce(p_data->>'description',''),coalesce(p_data->>'website',''),u,now(),now()+make_interval(hours=>hours)) returning * into row_data;
  insert into public.fox_staff_audit(actor,action,data) values(u,'server_catalog_add',jsonb_build_object('server_id',row_data.id,'name',row_data.name,'ends_at',row_data.ends_at));
  return jsonb_build_object('ok',true,'id',row_data.id,'starts_at',row_data.starts_at,'ends_at',row_data.ends_at);
 elsif p_op='remove' then
  update public.fox_server_catalog set removed_at=now() where id=(p_data->>'id')::uuid and removed_at is null returning * into row_data;
  if row_data.id is null then raise exception 'Активный сервер не найден'; end if;
  insert into public.fox_staff_audit(actor,action,data) values(u,'server_catalog_remove',jsonb_build_object('server_id',row_data.id,'name',row_data.name));
  return jsonb_build_object('ok',true);
 elsif p_op='admin_list' then
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
   from (select id,name,address,version,description,website,starts_at,ends_at,created_at from public.fox_server_catalog where ends_at>now() and removed_at is null order by created_at desc) x);
 else raise exception 'Неизвестная операция каталога серверов'; end if;
end; $$;
revoke all on function public.fox_server_catalog(text,jsonb) from public,anon;
grant execute on function public.fox_server_catalog(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;