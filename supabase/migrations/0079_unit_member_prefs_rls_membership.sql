-- 0079_unit_member_prefs_rls_membership.sql — unit_member_prefs RLS 에 매장 멤버십 강제 (보안 전용)
--
-- ── 배경(CSO Medium, 2026-07-24 발견) ───────────────────────────────────────────
-- 0076/0078 의 멤버십 가드(not_a_member)는 RPC(save_unit_member_prefs·ack_notifications)
-- 계층에만 있었고, 테이블 RLS(insert/update)는 user_id = auth.uid() 만 검사했다.
-- → 클라가 RPC 를 우회해 PostgREST 로 직접 upsert 하면 **소속하지 않은 실존 매장**에
--   자기 unit_member_prefs 행을 만들 수 있었다(실 백엔드 재현 확인). 타인 행 변조·발송 판정
--   영향은 없지만(user_id=self 제약·push 수신자는 profiles.unit_id 로 도출), "매장 격리=RLS 가
--   유일한 방어선"(db-rls) 불변식이 이 테이블에서 깨져 있었다 — 향후 이 테이블을 멤버십
--   증빙으로 오용하는 코드가 생기면 사고로 번지는 잠복 결함.
--
-- ── 처방 ────────────────────────────────────────────────────────────────────────
-- insert/update WITH CHECK 에 unit_members 멤버십 exists 를 추가한다(RLS 단독으로 성립).
-- definer RPC(0076·0078)는 RLS 를 우회하므로 기존 정상 경로는 무변 — 자체 가드가 계속 지킨다.
-- select 정책(본인 행만)은 의미 무변. 스칼라 함수는 (select …) 래핑(0019 패턴).
-- ⚠️ 보안 전용 — 성능 변경 없음(db-rls 분리 원칙). 게이트: /cso + audit-crosstenant(전→후).

drop policy if exists unit_member_prefs_insert on public.unit_member_prefs;
create policy unit_member_prefs_insert on public.unit_member_prefs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.unit_members m
      where m.user_id = (select auth.uid()) and m.unit_id = unit_member_prefs.unit_id
    )
  );

drop policy if exists unit_member_prefs_update on public.unit_member_prefs;
create policy unit_member_prefs_update on public.unit_member_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.unit_members m
      where m.user_id = (select auth.uid()) and m.unit_id = unit_member_prefs.unit_id
    )
  );

-- 위생: 이미 들어간 비소속 쓰레기 행 정리(멱등). 정상 행(멤버십 있음)은 건드리지 않는다.
delete from public.unit_member_prefs p
where not exists (
  select 1 from public.unit_members m
  where m.user_id = p.user_id and m.unit_id = p.unit_id
);
