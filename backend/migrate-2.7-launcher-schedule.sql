-- Fox Launcher global modes with exact scheduling.
-- Apply after migrate-2.6-launcher-modes.sql in Supabase SQL Editor.
begin;
create or replace function public.fox_launcher_mode(p_op text default 'get', p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := auth.uid();
  adm boolean := false;
  r public.fox_launcher_mode_state;
  m text;
  msg text;
  duration integer;
  start_time timestamptz;
  end_time timestamptz;
begin
  if u is null and p_op <> 'get' then raise exception 'Требуется вход в аккаунт Fox'; end if;
  if u is not null then select exists(select 1 from public.fox_admins where id=u) into adm; end if;
  insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;

  if p_op = 'set' then
    if not adm then raise exception 'Включать глобальные режимы может только владелец'; end if;
    m := p_data->>'mode';
    msg := btrim(coalesce(p_data->>'message',''));
    if m not in ('alarm','ceremony','maintenance','warning','celebration','info') then raise exception 'Неизвестный режим'; end if;
    if length(msg)=0 and m='alarm' then msg := 'ВНИМАНИЕ, РЕЖИМ ТРЕВОГИ. ЛАУНЧЕР ПОД УГРОЗОЙ. Просьба не заходить в лаунчер.'; end if;
    if length(msg) < 2 or length(msg) > 240 then raise exception 'Текст должен содержать от 2 до 240 символов'; end if;

    if nullif(p_data->>'starts_at','') is not null or nullif(p_data->>'ends_at','') is not null then
      if nullif(p_data->>'starts_at','') is null or nullif(p_data->>'ends_at','') is null then raise exception 'Нужно указать начало и окончание режима'; end if;
      start_time := (p_data->>'starts_at')::timestamptz;
      end_time := (p_data->>'ends_at')::timestamptz;
      if end_time <= start_time then raise exception 'Окончание должно быть позже начала'; end if;
      if (m='maintenance' and end_time-start_time > interval '7 days') or (m<>'maintenance' and end_time-start_time > interval '30 days') then raise exception 'Слишком большая длительность режима'; end if;
    else
      duration := nullif(p_data->>'duration_seconds','')::integer;
      if duration is null or duration < 5 then raise exception 'Недопустимая длительность'; end if;
      if (m='maintenance' and duration > 604800) or (m<>'maintenance' and duration > 1800) then raise exception 'Недопустимая длительность'; end if;
      start_time := now();
      end_time := now()+make_interval(secs=>duration);
    end if;

    update public.fox_launcher_mode_state
      set mode=m, message=msg, starts_at=start_time, ends_at=end_time, updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'clear' then
    if not adm then raise exception 'Выключать глобальные режимы может только владелец'; end if;
    update public.fox_launcher_mode_state
      set mode=null, message='', starts_at=null, ends_at=null, updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'get' then
    select * into r from public.fox_launcher_mode_state where id=1;
    if r.mode is not null and r.ends_at is not null and r.ends_at <= now() then
      update public.fox_launcher_mode_state set mode=null, message='', starts_at=null, ends_at=null, updated_at=now()
      where id=1 returning * into r;
    end if;
  else
    raise exception 'Неизвестная операция';
  end if;

  return jsonb_build_object(
    'mode', r.mode, 'message', r.message, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'updated_at', r.updated_at, 'is_admin', adm,
    'active', (r.mode is not null and (r.starts_at is null or r.starts_at <= now()) and (r.ends_at is null or r.ends_at > now())),
    'blocked', (r.mode='maintenance' and not adm and r.starts_at <= now() and r.ends_at > now())
  );
end $$;
revoke all on function public.fox_launcher_mode(text,jsonb) from public, anon;
grant execute on function public.fox_launcher_mode(text,jsonb) to anon, authenticated;
commit;
