-- Fox Launcher mode scheduling: exact local dates converted by the client to UTC.
-- Apply once after migrate-2.6-launcher-modes.sql in the Supabase SQL editor.
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
  scheduled_start timestamptz;
  scheduled_end timestamptz;
begin
  if u is null and p_op <> 'get' then raise exception 'Требуется вход в аккаунт Fox'; end if;
  if u is not null then select exists(select 1 from public.fox_admins where id=u) into adm; end if;
  insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;

  if p_op = 'set' then
    if not adm then raise exception 'Включать глобальные режимы может только владелец'; end if;
    m := p_data->>'mode';
    msg := btrim(coalesce(p_data->>'message',''));
    if m not in ('alarm','ceremony','maintenance','warning','celebration','info') then raise exception 'Неизвестный режим'; end if;
    if length(msg) < 2 or length(msg) > 240 then raise exception 'Текст должен содержать от 2 до 240 символов'; end if;

    if nullif(p_data->>'starts_at','') is not null or nullif(p_data->>'ends_at','') is not null then
      if nullif(p_data->>'starts_at','') is null or nullif(p_data->>'ends_at','') is null then
        raise exception 'Укажите и начало, и конец режима';
      end if;
      scheduled_start := (p_data->>'starts_at')::timestamptz;
      scheduled_end := (p_data->>'ends_at')::timestamptz;
      if scheduled_start <= now() then raise exception 'Для запланированного режима начало должно быть в будущем'; end if;
      if scheduled_end <= scheduled_start then raise exception 'Дата окончания должна быть позже начала'; end if;
      if scheduled_end > scheduled_start + interval '30 days' then raise exception 'Режим нельзя запланировать более чем на 30 дней'; end if;
    else
      duration := (p_data->>'duration_seconds')::integer;
      if duration is null or duration < 5 then raise exception 'Недопустимая длительность'; end if;
      if (m='maintenance' and duration > 86400) or (m<>'maintenance' and duration > 1800) then raise exception 'Недопустимая длительность'; end if;
      scheduled_start := now();
      scheduled_end := now()+make_interval(secs=>duration);
    end if;

    update public.fox_launcher_mode_state
      set mode=m, message=msg, starts_at=scheduled_start, ends_at=scheduled_end,
          updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'clear' then
    if not adm then raise exception 'Выключать глобальные режимы может только владелец'; end if;
    update public.fox_launcher_mode_state
      set mode=null, message='', starts_at=null, ends_at=null, updated_by=u, updated_at=now()
      where id=1 returning * into r;
  elsif p_op = 'get' then
    select * into r from public.fox_launcher_mode_state where id=1;
    if r.mode is not null and r.ends_at is not null and r.ends_at <= now() then
      update public.fox_launcher_mode_state
        set mode=null, message='', starts_at=null, ends_at=null, updated_at=now()
        where id=1 returning * into r;
    end if;
  else
    raise exception 'Неизвестная операция';
  end if;

  return jsonb_build_object(
    'mode', case when r.starts_at is null or r.starts_at <= now() then r.mode else null end,
    'message', case when r.starts_at is null or r.starts_at <= now() then r.message else '' end,
    'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'scheduled', (r.mode is not null and r.starts_at > now()),
    'updated_at', r.updated_at, 'is_admin', adm,
    'blocked', (r.mode='maintenance' and r.starts_at <= now() and not adm)
  );
end $$;
revoke all on function public.fox_launcher_mode(text,jsonb) from public, anon;
grant execute on function public.fox_launcher_mode(text,jsonb) to anon, authenticated;
commit;
