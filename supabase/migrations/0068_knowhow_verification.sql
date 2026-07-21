-- 0068: 노하우 검증 상태 영속화 (사장 "검증함"이 저장되지 않던 무음 실패 수정)
--
-- 증상: OwnerKnowhowBrowse/edit 화면이 verification:{state:'owner_verified'}를 써도
--       db.ts의 stripNonColumns가 write 직전에 떼어냈다(0001에 컬럼이 없어 PGRST204로 전체 거부되므로).
--       배지는 낙관적 업데이트로 그려져 사장 눈엔 저장된 것처럼 보이고, 새로고침하면 사라졌다.
-- 구조: "검증 상태"라는 규칙이 타입(types/index.ts)·UI(verifyMeta)에는 있는데 저장 계층에만 없던 불일치.
--       컬럼을 만들어 계층을 맞추고, db.ts의 strip에서 verification만 해제한다.
--
-- source(kind)는 이번 범위가 아니다 — 컬럼 없음 유지, strip도 유지.
--
-- ⚠️ additive only(nullable) — 구버전 클라 하위호환·롤백 안전. RLS 변경 없음(행 단위 정책이 그대로 적용).
-- ⚠️ 스키마 먼저, 앱 배포 나중(0063과 동일 순서). 앱이 먼저 나가면 PGRST204로 노하우 수정 전체가 죽는다.

alter table public.playbook_entries
  add column if not exists verification jsonb;

comment on column public.playbook_entries.verification is
  '검증 상태 {state: owner_verified|field_tested|unverified, verified_by, verified_at}. null=미검증(확인 필요)';
