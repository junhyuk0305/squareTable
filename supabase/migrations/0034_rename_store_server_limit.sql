-- 0034_rename_store_server_limit.sql — 매장명 변경 제한을 서버에서 강제 (남용 #28)
--
-- 왜: 14일 2회 제한이 클라 localStorage에만 있어 재설치·다른 기기·데브툴로 우회 가능했다
--   (브랜드 사칭/혼동 위험). 변경 이력을 units에 영속하고 RPC가 서버에서 카운트·차단한다.
--   security definer라 RLS와 무관하게 '본인 소유 매장'에만 동작한다.
--
-- 이력 저장: units.rename_events(timestamptz[])에 변경 시각을 누적. RPC가 최근 14일치만 세어
--   2회 이상이면 rename_limit. 계정/매장 재생성으로도 우회 불가(unit 단위 영속).

alter table public.units add column if not exists rename_events timestamptz[] not null default '{}';

create or replace function public.rename_store(p_name text)
returns int  -- 남은 변경 가능 횟수
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_name   text := trim(coalesce(p_name, ''));
  v_recent timestamptz[];
  v_cnt    int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' then raise exception 'store_name_required'; end if;

  -- 본인 소유 매장만(rotate_invite_code와 동일 확인 패턴).
  select unit_id into v_unit from public.profiles where id = v_uid and role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units where id = v_unit and owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- 최근 14일 변경 이력만 유지(오래된 건 정리) + 카운트.
  select array(
           select t from unnest(coalesce(u.rename_events, '{}')) as t
           where t > now() - interval '14 days'
         )
    into v_recent
    from public.units u where u.id = v_unit;
  v_cnt := coalesce(array_length(v_recent, 1), 0);
  if v_cnt >= 2 then raise exception 'rename_limit'; end if;

  update public.units
     set store_name = v_name,
         rename_events = v_recent || now()
   where id = v_unit;

  return 2 - (v_cnt + 1);  -- 이번 변경 반영 후 남은 횟수
end $$;

grant execute on function public.rename_store(text) to authenticated;
