-- 0024_playbook_templates.sql — 업종 표준 노하우 팩 온보딩(자동등록) 메타 컬럼
-- 사장 온보딩에서 업종 표준 템플릿을 선택→매장 노하우로 fork할 때 출처·검수상태를 남긴다.
--  • is_template       : 순수 템플릿 여부(번들 JSON에서만 true). 매장으로 fork되면 false로 등록.
--  • pack_id           : 출처 팩(common|cafe…) — 프로비넌스/추후 분석용.
--  • needs_review      : 사장이 아직 교정 안 한 '매장 기본값(미확인)'. 관리화면·알바답에 배지.
--  • correction_points : 사장이 바꿀 확률 높은 변수(환불 한도·연락처 등) — 추후 pull 루프 진입점.
--
-- ⚠️ RLS 술어(USING/WITH CHECK) 변경 없음 = 의미보존 안전 마이그레이션.
--    새 컬럼은 playbook_entries의 기존 테넌트(unit_id) 정책을 그대로 상속한다(별도 정책 불요).
alter table public.playbook_entries
  add column if not exists is_template       boolean not null default false,
  add column if not exists pack_id           text,
  add column if not exists needs_review      boolean not null default false,
  add column if not exists correction_points text[]  not null default '{}';

-- 사장 '내 노하우' 관리화면에서 미확인(needs_review) 항목을 빠르게 필터하기 위한 부분 인덱스.
create index if not exists idx_pb_needs_review
  on public.playbook_entries(unit_id)
  where needs_review;
