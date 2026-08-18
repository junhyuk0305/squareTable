-- 0146_routine_date_override.sql
-- 루틴 업무의 '오늘 하루만 수정'(날짜 예외)을 실제 할일 행으로 표현한다.
--
-- 배경: 루틴은 테이블 행이 아니라 schedule_config.dayparts 에서 매일 파생되는 합성 할일이라
--       "오늘 것만 다르게"를 적을 자리가 없었다. 별도 override 테이블을 새로 만드는 대신,
--       **이미 있는 work_templates 한 행**으로 그날의 대체본을 만든다:
--         · date            = 대체할 그 날짜
--         · replaces_routine_id = 대신하는 루틴 id(dayparts 안의 routine.id, dpr_ 접두사 없음)
--       할일 목록은 그 날짜에 원본 루틴을 건너뛰고 이 행을 대신 보여준다(occursOn.skipDates).
--
-- 안전성:
--  · additive only — 컬럼 1개 추가. 기존 행/클라이언트는 NULL 이라 판정이 1mm도 안 바뀐다.
--  · **RLS 정책을 건드리지 않는다.** work_templates 의 기존 unit 격리 정책이 그대로 적용된다
--    (새 테이블을 만들었다면 정책 4개를 새로 써야 했고 그만큼 격리 실수 여지가 늘었다).

alter table public.work_templates
  add column if not exists replaces_routine_id text;

-- 그날의 대체본을 찾는 조회 경로(매장 + 루틴 + 날짜). 대체본만 있으면 되니 부분 인덱스.
create index if not exists work_templates_replaces_routine_idx
  on public.work_templates (unit_id, replaces_routine_id, date)
  where replaces_routine_id is not null;

comment on column public.work_templates.replaces_routine_id is
  '루틴 하루 예외(0146): 이 행이 대신하는 schedule_config.dayparts 의 routine id. 같은 date 에는 원본 루틴이 할일에 뜨지 않는다. NULL이면 일반 할일.';
