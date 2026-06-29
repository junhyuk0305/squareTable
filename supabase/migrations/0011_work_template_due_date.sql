-- 예정 할일(미래 날짜에 미리 적는 일회성 할일)을 위해 due_date 추가.
-- due_date IS NULL  → 매일 반복되는 루틴 템플릿(기존 동작)
-- due_date = 'YYYY-MM-DD' → 그 날짜에만 뜨는 일회성 '예정 할일'
alter table public.work_templates
  add column if not exists due_date text;

-- 날짜별 조회 가속(루틴은 NULL이라 인덱스에서 자연 제외)
create index if not exists idx_wt_unit_due on public.work_templates(unit_id, due_date);
