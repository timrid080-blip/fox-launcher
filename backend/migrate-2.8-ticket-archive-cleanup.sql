-- Fox Launcher 4.0.3: ticket archive/deletion, retention and direct-message cleanup.
-- Apply in Supabase SQL Editor after the existing migrations (including 2.0 and 2.6).
begin;

alter table public.fox_tickets
  add column if not exists closed_at timestamptz,
  add column if not exists appeal_until timestamptz,
  add column if not exists archived_at timestamptz;

create index if not exists fox_tickets_archive_due
  on public.fox_tickets(archived_at, closed_at)
  where status='closed';

create or replace function public.fox_ticket_lifecycle()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='closed' and (tg_op='INSERT' or old.status is distinct from 'closed') then
    new.closed_at := coalesce(new.closed_at,now());
    new.appeal_until := coalesce(new.appeal_until,new.closed_at+interval '1 day');
    new.archived_at := coalesce(new.archived_at,new.closed_at+interval '1 minute');
  elsif new.status='open' then
    new.closed_at := null;
    new.appeal_until := null;
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists fox_ticket_lifecycle_trigger on public.fox_tickets;
create trigger fox_ticket_lifecycle_trigger
before insert or update of status on public.fox_tickets
for each row execute function public.fox_ticket_lifecycle();

-- Called by support views. Open tickets are given two days to be resolved;
-- closed tickets stay available for a one-day appeal window and are archived
-- one minute after closure. Records/messages are purged three days after closure.
create or replace function public.fox_support_cleanup()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); closed_count integer:=0; deleted_count integer:=0; chat_count integer:=0;
begin
  if u is null then raise exception 'Войди в Fox ID'; end if;

  update public.fox_tickets
    set status='closed',closed_at=created_at+interval '2 days',
        appeal_until=created_at+interval '3 days',
        archived_at=created_at+interval '2 days 1 minute',
        updated_at=now()
    where status='open' and created_at<=now()-interval '2 days';
  get diagnostics closed_count=row_count;

  delete from public.fox_tickets
    where status='closed' and closed_at is not null and closed_at<=now()-interval '3 days';
  get diagnostics deleted_count=row_count;

  delete from public.fox_friend_messages where created_at<=now()-interval '3 days';
  get diagnostics chat_count=row_count;

  return jsonb_build_object('closed',closed_count,'deleted_tickets',deleted_count,'deleted_direct_messages',chat_count);
end;
$$;

create or replace function public.fox_support_archive_list()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); staff boolean;
begin
  if u is null then raise exception 'Войди в Fox ID'; end if;
  select exists(select 1 from public.fox_admins where id=u)
    or exists(select 1 from public.fox_roles where user_id=u and role in ('support','support_lead')) into staff;
  if not staff then raise exception 'Архив доступен только команде поддержки'; end if;
  perform public.fox_support_cleanup();
  return (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.archived_at desc),'[]'::jsonb)
    from (
      select t.id,t.title,t.status,t.created_at,t.updated_at,t.closed_at,t.appeal_until,t.archived_at,
        p.nickname,ap.nickname assigned
      from public.fox_tickets t
      join public.fox_profiles p on p.id=t.user_id
      left join public.fox_profiles ap on ap.id=t.assigned
      where t.status='closed' and t.archived_at<=now()
      order by t.archived_at desc limit 500
    ) q
  );
end;
$$;

create or replace function public.fox_support_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); row_data jsonb;
begin
  if u is null or not exists(select 1 from public.fox_admins where id=u) then
    raise exception 'Удалять тикеты может только владелец Fox Launcher';
  end if;
  select jsonb_build_object('id',id,'user_id',user_id,'title',title,'status',status)
    into row_data from public.fox_tickets where id=p_id for update;
  if row_data is null then raise exception 'Тикет не найден'; end if;
  insert into public.fox_staff_audit(actor,action,data)
    values(u,'support_ticket_deleted',row_data);
  delete from public.fox_tickets where id=p_id;
  return jsonb_build_object('ok',true,'deleted',p_id);
end;
$$;

revoke all on function public.fox_ticket_lifecycle() from public,anon,authenticated;
revoke all on function public.fox_support_cleanup() from public,anon;
revoke all on function public.fox_support_archive_list() from public,anon;
revoke all on function public.fox_support_delete(uuid) from public,anon;
grant execute on function public.fox_support_cleanup() to authenticated;
grant execute on function public.fox_support_archive_list() to authenticated;
grant execute on function public.fox_support_delete(uuid) to authenticated;
commit;
