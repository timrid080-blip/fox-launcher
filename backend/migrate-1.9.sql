-- Fox Launcher 1.9: owner-managed promo and author code registry.
-- Apply after migrations 1.2 through 1.8. Back up the database first.
begin;
create table if not exists public.fox_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind text not null check(kind in ('promo','author')),
  owner_id uuid references public.fox_profiles(id) on delete set null,
  discount_percent integer not null default 10 check(discount_percent between 0 and 90),
  commission_percent integer not null default 0 check(commission_percent between 0 and 30),
  enabled boolean not null default true,
  created_by uuid not null references public.fox_profiles(id),
  created_at timestamptz not null default now(),
  constraint fox_codes_code_format check(code ~ '^[A-Z0-9_-]{3,24}$'),
  constraint fox_codes_kind_values check((kind='promo' and owner_id is null and commission_percent=0) or (kind='author' and commission_percent between 0 and 30))
);
create unique index if not exists fox_codes_code_lower_unique on public.fox_codes(lower(code));
alter table public.fox_codes enable row level security;
revoke all on public.fox_codes from anon,authenticated;

create or replace function public.fox_owner_codes(p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); k text; c text; kind_value text; owner_value uuid; disc integer; comm integer; enabled_value boolean; code_id uuid;
begin
 if actor is null or not exists(select 1 from public.fox_admins where id=actor) then raise exception 'Доступ только владельцу'; end if;
 if p_op='list' then
   return (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'kind',x.kind,'owner_id',x.owner_id,'owner_nickname',p.nickname,'discount_percent',x.discount_percent,'commission_percent',x.commission_percent,'enabled',x.enabled,'created_at',x.created_at) order by x.created_at desc),'[]'::jsonb) from public.fox_codes x left join public.fox_profiles p on p.id=x.owner_id);
 elsif p_op='save' then
   c:=upper(trim(coalesce(p_data->>'code',''))); kind_value:=p_data->>'kind'; owner_value:=nullif(p_data->>'owner_id','')::uuid;
   disc:=coalesce((p_data->>'discount_percent')::integer,10); comm:=coalesce((p_data->>'commission_percent')::integer,0); enabled_value:=coalesce((p_data->>'enabled')::boolean,true); code_id:=nullif(p_data->>'id','')::uuid;
   if c !~ '^[A-Z0-9_-]{3,24}$' then raise exception 'Код: 3–24 символа, латиница, цифры, _ или -'; end if;
   if kind_value not in ('promo','author') then raise exception 'Неизвестный тип кода'; end if;
   if disc<0 or disc>90 then raise exception 'Скидка должна быть 0–90%%'; end if;
   if kind_value='promo' then owner_value:=null; comm:=0; else
     if owner_value is null or not exists(select 1 from public.fox_profiles where id=owner_value) then raise exception 'Для авторского кода выбери владельца'; end if;
     if comm<0 or comm>30 then raise exception 'Комиссия автора должна быть 0–30%%'; end if;
   end if;
   if code_id is null then
     insert into public.fox_codes(code,kind,owner_id,discount_percent,commission_percent,enabled,created_by) values(c,kind_value,owner_value,disc,comm,enabled_value,actor);
   else
     update public.fox_codes set code=c,kind=kind_value,owner_id=owner_value,discount_percent=disc,commission_percent=comm,enabled=enabled_value where id=code_id;
     if not found then raise exception 'Код не найден'; end if;
   end if;
   insert into public.fox_staff_audit(actor,action,data) values(actor,'code_manage',jsonb_build_object('code',c,'kind',kind_value,'owner_id',owner_value,'discount_percent',disc,'commission_percent',comm,'enabled',enabled_value));
   return jsonb_build_object('ok',true);
 elsif p_op='toggle' then
   code_id:=(p_data->>'id')::uuid; enabled_value:=(p_data->>'enabled')::boolean;
   update public.fox_codes set enabled=enabled_value where id=code_id;
   if not found then raise exception 'Код не найден'; end if;
   insert into public.fox_staff_audit(actor,action,data) values(actor,'code_toggle',jsonb_build_object('id',code_id,'enabled',enabled_value));
   return jsonb_build_object('ok',true);
 end if;
 raise exception 'Неизвестная операция управления кодами';
end; $$;
revoke all on function public.fox_owner_codes(text,jsonb) from public,anon;
grant execute on function public.fox_owner_codes(text,jsonb) to authenticated;
commit;
