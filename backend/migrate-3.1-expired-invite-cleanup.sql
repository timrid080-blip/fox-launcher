-- Fox Launcher 6.0: remove expired temporary game invitations from direct chat history.
-- Apply after backend/migrate-3.0-group-calls.sql.
begin;

create or replace function public.fox_support_cleanup()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 closed_count integer:=0;
 deleted_count integer:=0;
 chat_count integer:=0;
 group_chat_count integer:=0;
 expired_invite_count integer:=0;
begin
 update public.fox_tickets set status='closed',closed_at=created_at+interval '2 days',
  appeal_until=created_at+interval '3 days',archived_at=created_at+interval '2 days 1 minute',updated_at=now()
  where status='open' and created_at<=now()-interval '2 days';
 get diagnostics closed_count=row_count;

 delete from public.fox_tickets where status='closed' and created_at<=now()-interval '3 days' and appeal_until is not null and appeal_until<=now();
 get diagnostics deleted_count=row_count;

 -- Invite timestamps are Unix milliseconds embedded by the renderer in [[FOX_INVITE|<13 digits>|...]].
 delete from public.fox_friend_messages
  where body ~ '\[\[FOX_INVITE\|[0-9]{13}\|'
    and substring(body from '\[\[FOX_INVITE\|([0-9]{13})\|')::bigint
        < floor(extract(epoch from now())*1000)::bigint;
 get diagnostics expired_invite_count=row_count;

 delete from public.fox_friend_messages where created_at<=now()-interval '3 days';
 get diagnostics chat_count=row_count;

 delete from public.fox_chat_group_messages where created_at<=now()-interval '3 days';
 get diagnostics group_chat_count=row_count;

 return jsonb_build_object(
  'closed',closed_count,
  'deleted_tickets',deleted_count,
  'deleted_direct_messages',chat_count,
  'deleted_expired_invites',expired_invite_count,
  'deleted_group_messages',group_chat_count
 );
end; $$;

revoke all on function public.fox_support_cleanup() from public,anon;
grant execute on function public.fox_support_cleanup() to authenticated;
notify pgrst, 'reload schema';
commit;
