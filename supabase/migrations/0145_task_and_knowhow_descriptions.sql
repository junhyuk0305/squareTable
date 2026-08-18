-- 0145_task_and_knowhow_descriptions.sql
-- 작업/루틴/노하우의 설명 텍스트를 DB에도 영속화한다.
--
-- 목적:
--  - work_templates.description: 할일 상세 설명(제목 외 추가 메모)
--  - playbook_entries.description: 노하우 설명(요약/메모)
--
-- 안전성:
--  - additive only: 기존 데이터/클라이언트와 호환을 깨지 않는다.
--  - description 은 nullable text 로 두어 빈 값과 미입력 상태를 모두 표현한다.

alter table public.work_templates
  add column if not exists description text;

alter table public.playbook_entries
  add column if not exists description text;

-- 기존 JSON 스냅샷에 description 이 이미 들어가 있다면, 새 컬럼으로 안전하게 복사한다.
-- (현재 앱은 일부 값이 square.description 또는 task description 형태로 들어올 수 있어 하위호환을 위해 보완)
update public.playbook_entries
set description = coalesce(description, square->>'description')
where description is null
  and jsonb_typeof(square) = 'object'
  and square ? 'description'
  and nullif(square->>'description', '') is not null;

comment on column public.work_templates.description is
  '선택 설명: 할일의 상세 메모. 빈 문자열 또는 NULL이면 설명 없음.';

comment on column public.playbook_entries.description is
  '선택 설명: 노하우의 상세 메모. 기존 square JSON과 함께 보조 설명을 저장할 수 있다.';
