-- Fox Launcher global alert / maintenance modes.
-- Apply once in the Supabase SQL editor after the existing Fox Club migrations.
begin;
create table if not exists public.fox_launcher_mode_state (
  id integer primary key check (id = 1),
  mode text check (mode in ('alarm','ceremony','maintenance','warning','celebration','info')),
  message text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (mode is null or (starts_at is not null and (ends_at is null or ends_at > starts_at)))
);
insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;
alter table public.fox_launcher_mode_state enable row level security;
revoke all on public.fox_launcher_mode_state from public, anon, authenticated;

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
begin
  if u is null then raise exception 'Требуется вход в аккаунт Fox'; end if;
  select exists(select 1 from public.fox_admins where id=u) into adm;
  insert into public.fox_launcher_mode_state(id) values (1) on conflict(id) do nothing;

  if p_op = 'set' then
    if not adm then raise exception 'Включать глобальные режимы может только владелец'; end if;
    m := p_data->>'mode';
    msg := btrim(coalesce(p_data->>'message',''));
    duration := (p_data->>'duration_seconds')::integer;
    if m not in ('alarm','ceremony','maintenance','warning','celebration','info') then raise exception 'Неизвестный режим'; end if;
    if duration < 5 or duration > case when m='maintenance' then 86400 else 1800 end then raise exception 'Недопустимая длительность'; end if;
    if length(msg) < 2 or length(msg) > 240 then raise exception 'Текст должен содержать от 2 до 240 символов'; end if;
    update public.fox_launcher_mode_state
      set mode=m, message=msg, starts_at=now(), ends_at=now()+make_interval(secs=>duration),
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
    'mode', r.mode, 'message', r.message, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'updated_at', r.updated_at, 'is_admin', adm,
    'blocked', (r.mode='maintenance' and not adm)
  );
end $$;
revoke all on function public.fox_launcher_mode(text,jsonb) from public, anon;
grant execute on function public.fox_launcher_mode(text,jsonb) to authenticated;
commit;
