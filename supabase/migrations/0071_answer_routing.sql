-- 0071_answer_routing.sql
-- S1 ③ 질문 라우팅(D4) — 직원 전체가 매장 미답질문에 답할 수 있게 한다.
-- RLS는 손대지 않는다: unknown_queries 는 이미 `_rw for all using unit_id = auth_unit_id()`(0001)로
--   같은 매장 직원 전체에게 SELECT/UPDATE 가 열려 있다(0020 이 "현역이니 건드리지 말라"고 명시).
--   따라서 D4 는 클라이언트 진입점·알림 대상만 확장하면 되고, 여기선 추적용 컬럼 2개만 가산한다.
--
-- ⚠️ 둘 다 additive nullable · RLS 무변경 · 롤백 안전.

-- 누가 답했나 — '즉시 해결'(직원이 기존 노하우를 답으로 지정) 경로에서 기록. "내가 답한 질문"·크레딧용.
-- stamp_author(0007)는 BEFORE INSERT 트리거라 UPDATE 로 채우는 이 컬럼과 간섭 없음.
alter table public.unknown_queries
  add column if not exists answered_by uuid references auth.users(id) on delete set null;
comment on column public.unknown_queries.answered_by is
  'S1 ③(D4) 이 질문을 해결한 사람(auth.users). 직원이 기존 노하우로 즉시 해결 시 기록. null=미해결/사장AI자동';

-- 새-답 제안이 어느 미답질문의 답인지 — 사장 승인(coach) 시 그 질문을 자동 resolve 하기 위한 앵커.
-- FK는 걸지 않는다(0014 target_entry_id·0070 source_template_id 와 동일 원칙 — 질문이 지워져도 제안 맥락 보존).
alter table public.playbook_suggestions
  add column if not exists source_uq_id text;
comment on column public.playbook_suggestions.source_uq_id is
  'S1 ③(D4) 직원의 새-답 제안이 답하는 미답질문(unknown_queries.id). 승인·발행 시 그 질문 자동 resolve. null=일반 제안';
