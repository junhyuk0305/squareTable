-- 0095_profiles_read_membership.sql — 다점포 직원이 승인 후 사장 직원 목록에 안 보이는 버그 수정.
--
-- 증상(qa-junior-multistore 실증): 이미 다른 매장 소속인 직원이 2호점에 합류 승인되면
--   approve_member(0093)가 profiles.unit_id(주매장)를 보존하므로, 2호점 사장의
--   profiles_read(0032: unit_id=활성매장 or 본인 or pending) 어느 분기에도 안 걸려
--   명부(fetchStaffProfiles)에서 0행 → 승인했는데 직원 목록에 영원히 안 나타남.
-- 원인 = 구조 불일치: 소속의 SSOT는 unit_members(0055/0067)인데 읽기 정책만 주매장 컬럼 기준.
-- 수정: 활성 매장의 멤버(unit_members) 분기 추가. 그 외 분기는 0032와 1mm 동일(의미 보존).
-- 노출 범위 검토: 추가로 보이는 행 = "내 활성 매장의 멤버" 프로필뿐 — 같은 매장 명부와
--   동일한 노출 수준(0077 통합 알림 names와 같음). 크로스테넌트 누출 없음(멤버십 없는 매장은 불가).
-- 게이트: qa-junior-multistore(신규 명부 체크 포함) + qa-multistore 크로스테넌트 green 필수.

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (
    unit_id = (select public.auth_unit_id())
    or id = (select auth.uid())
    or pending_unit_id = (select public.auth_unit_id())
    -- ★소속 SSOT 분기: 활성 매장의 멤버면 주매장이 어디든 명부에 보인다(다점포 직원).
    or exists (
      select 1 from public.unit_members m
       where m.user_id = profiles.id
         and m.unit_id = (select public.auth_unit_id())
    )
  );
