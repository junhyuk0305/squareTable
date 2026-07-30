-- 0095_knowhow_custom_categories.sql — 노하우 카테고리 매장 커스텀.
-- 배경: 기본 4종(Routine/Event/Context/Know-how)은 AI 분류·카테고리별 추출 가이드의 전제라 유지하고,
--   매장이 직접 만드는 커스텀 카테고리를 허용한다(발행 전 "종류" 칩에서 수동 지정 전용 — AI는 기본 4종만 분류).
-- 1) playbook_entries.category CHECK 를 4값 고정 → 길이 검사로 완화(커스텀 id 저장 허용).
--    기존 행은 전부 4종이라 검증 통과. 라벨이 아니라 커스텀 id(kc_…)를 저장한다(이름 변경 시 행 무변경).
-- 2) 커스텀 목록은 매장 공유 설정 schedule_config.knowhow_categories(jsonb)에 저장.
--    dayparts 0046 전례: unit_id RLS 격리·읽기=매장 전원·쓰기=auth_can_manage(0093) 이미 확보 — RLS 무변경.

alter table public.playbook_entries
  drop constraint if exists playbook_entries_category_check;
alter table public.playbook_entries
  add constraint playbook_entries_category_check
  check (char_length(category) between 1 and 40);

alter table public.schedule_config
  add column if not exists knowhow_categories jsonb not null default '[]'::jsonb;

comment on column public.schedule_config.knowhow_categories is
  '노하우 커스텀 카테고리 [{id,label}] — 기본 4종 외 매장이 만든 종류(AI 자동 분류 없음, 수동 지정 전용). 해석/정리는 src/lib/store/knowhowCategories.ts(resolve/sanitize)가 SSOT.';
