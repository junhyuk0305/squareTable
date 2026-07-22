-- 0070_suggestion_source_template.sql
-- 노하우 제안(playbook_suggestions, 0014)에 "출처 업무" 앵커 추가 — S1 ②(완료 직후 1턴 캡처).
-- 알바가 반복 업무를 완료하며 남긴 한 줄이 제안으로 올라오고, 사장이 승인하면 그 결과 노하우를
-- 원본 업무에 자동 첨부(0069 work_template_knowhow)하기 위한 링크.
--
-- ⚠️ FK는 걸지 않는다 — 0014 의 target_entry_id 와 동일 원칙(업무가 삭제돼도 제안 맥락은 보존).
--    승인 시점에 업무가 사라졌으면 자동 첨부만 건너뛴다(제안·발행 자체는 정상).
-- ⚠️ additive only(nullable) · RLS 변경 없음(기존 ps_* 정책이 그대로 적용).

alter table public.playbook_suggestions
  add column if not exists source_template_id text;

comment on column public.playbook_suggestions.source_template_id is
  'S1 ② 완료 캡처 출처 업무(work_templates.id). 승인 시 이 업무에 결과 노하우를 자동 첨부(0069). null=일반 제안';
