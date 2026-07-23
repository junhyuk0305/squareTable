-- 0080_profiles_pending_unit_idx.sql — profiles.pending_unit_id 부분 인덱스 (성능 전용)
--
-- 0077 my_units_notif_data 의 join 분기와 fetchPendingMembers 가 pending_unit_id 로 조회하는데
-- 인덱스가 없었다. profiles 는 전 테넌트 공통 글로벌 테이블이라 사용자 총량에 선형 비례 —
-- 지금 규모엔 무해하지만 성장 시 유일하게 스케일에 취약한 지점(2026-07-24 효율 리뷰).
-- pending 은 대부분 null 이므로 부분 인덱스로 크기를 최소화한다.
-- ⚠️ 성능 전용 — RLS/의미 변경 없음(db-rls 분리 원칙).

create index if not exists idx_profiles_pending_unit
  on public.profiles (pending_unit_id)
  where pending_unit_id is not null;
