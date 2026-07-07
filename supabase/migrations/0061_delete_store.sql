-- 0061_delete_store.sql — 다점포: 매장 하나 삭제(오너 전용). 다점포에 필요했던 '삭제' 경로 신설.
--
-- ── 배경 ──────────────────────────────────────────────────────────────────────
-- 다점포(0055)로 오너가 매장을 여러 개 가질 수 있게 됐지만 '개별 매장 삭제' 경로가 없었다
-- (delete_my_account=계정 전체, leave_store=직원 소속해제뿐). 온보딩 레이스로 중복 생성된 매장을
-- 지울 수단도 없었다. 이 RPC로 오너가 자기 매장 하나를 안전하게 제거한다.
--
-- ── 안전장치(모두 필수) ───────────────────────────────────────────────────────
-- ★소유검증: units.owner_id = auth.uid() (definer=RLS 우회이므로 이게 유일 방어선. 직원/타사장 차단).
-- ★마지막 매장 금지: 오너가 매장 0개로 고아되는 것 방지(그건 delete_my_account로). 반드시 ≥1 유지.
-- ★직원 있으면 금지: 나 외 멤버(직원)가 있으면 store_has_staff → 먼저 내보내라(실수로 직원·데이터 순삭 방지).
-- ★포인터 재지정: 삭제 매장이 active_unit_id/unit_id면 다른 내 매장으로 옮긴 뒤 삭제(댕글링 방지).
-- 실삭제: units 삭제 → 19개 테넌트 테이블·unit_members·unit_subscriptions가 FK on delete cascade로 함께 정리.
--   (되돌릴 수 없음 → UI는 빨강 확인 모달로 게이팅. remove_staff와 동일 톤.)
--
-- RLS/USING 술어 변경 없음(신규 함수만) — /cso + /qa 크로스테넌트·안전장치 게이트 후 적용. 적용 후 pg_get_functiondef 확인.

create or replace function public.delete_store(p_unit_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_alt text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★소유검증(유일 방어선)
  if not exists (select 1 from public.units u where u.id = p_unit_id and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- ★마지막(유일) 매장은 삭제 불가 → 계정삭제로 유도
  if (select count(*) from public.units u where u.owner_id = v_uid and u.deleted_at is null) <= 1 then
    raise exception 'last_store';
  end if;

  -- ★직원(나 외 멤버)이 있으면 차단 — 먼저 내보내라
  if exists (select 1 from public.unit_members m where m.unit_id = p_unit_id and m.user_id <> v_uid) then
    raise exception 'store_has_staff';
  end if;

  -- 활성/주매장이 이 매장이면 다른 내 매장(가장 오래된)으로 재지정
  select u.id into v_alt
    from public.units u
   where u.owner_id = v_uid and u.id <> p_unit_id and u.deleted_at is null
   order by u.created_at
   limit 1;
  update public.profiles
     set active_unit_id = case when active_unit_id = p_unit_id then v_alt else active_unit_id end,
         unit_id        = case when unit_id        = p_unit_id then v_alt else unit_id        end
   where id = v_uid;

  -- 실삭제(units → 전 테넌트 테이블·unit_members·unit_subscriptions FK cascade)
  delete from public.units where id = p_unit_id;
end $$;

grant execute on function public.delete_store(text) to authenticated;
