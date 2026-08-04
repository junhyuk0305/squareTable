-- 0110_work_template_hidden.sql — 퀴즈 때문에 생긴 '껍데기 업무'를 할일에서 숨긴다 (1단계)
--
-- 문제: 코스에 노하우를 담을 때 addTrainingTask 가 work_templates 행을 새로 만들었는데
--   그 행에 recurrence 도 date 도 없다 → occursOn() 의 레거시 분기가 "매일 루틴"으로 판정한다
--   (0013 이전 데이터를 살리려고 둔 분기다). 담은 개수만큼 매일 할일이 영구히 늘어난다.
--
-- 왜 occursOn 을 안 고치나: 그 함수의 레거시 분기는 **진짜 레거시 할일**(0013 이전 행)도 살린다.
--   여기서 의미를 바꾸면 관계없는 할일이 통째로 사라진다. 판정이 아니라 **행에 표시**를 둔다.
--
-- 왜 recurrence='once' + date 없음 으로 안 하나: 그 조합은 occursOn 주석이 "잘못된 항목"이라
--   부르는 상태다. 일부러 숨긴 것과 깨진 데이터를 구분할 수 없게 되고, 나중에 데이터를 고치는
--   스크립트가 이걸 되살릴 수 있다. 의도를 컬럼 이름으로 남긴다.
--
-- 되돌릴 수 있어야 한다(기획 1단계 ③) — boolean 이라 false 로 돌리면 그대로 복구된다.
-- 업무 자체·노하우 링크·코스 소속은 손대지 않는다. 할일 목록에서만 빠진다.

alter table public.work_templates
  add column if not exists hidden boolean not null default false;

comment on column public.work_templates.hidden is
  '할일 목록에서 숨김(0110). true = 보드·캘린더에 뜨지 않는다. 퀴즈가 만들어 낸 껍데기 업무를
   사장이 정리한 표시이며, 업무 행·노하우 링크·코스 소속은 그대로 남는다(되돌리기 가능).';

-- 보드는 항상 "안 숨긴 것"만 읽는다 → 매장별 부분 인덱스.
create index if not exists idx_wt_unit_visible on public.work_templates(unit_id) where hidden = false;

-- RLS 무변경: wt_update(0019)가 이미 같은 매장·같은 방이면 update 를 허용한다.
-- 숨김은 업무 본문 수정과 같은 등급의 쓰기라 새 정책을 만들지 않는다(권한 확대 0).
