-- 0043_kpi_containment_fix.sql — containment 뷰의 뒤집힌 컬럼 정정 + AI 폴백 3분할 (리포트 P1-8 / P1-9)
--
-- P1-8: kpi_containment_weekly.deflected_to_owner 가 `count(*) filter (where was_deflected)` 로 정의돼
--   실제로는 정반대를 센다. was_deflected 는 코드에서 "AI가 사장으로부터 질문을 쳐냈다(=직접 답했다)"
--   의미다(useChatStore: served/generated 답변 시 was_deflected=true, 사장에게 라우팅 시 false).
--   따라서 "사장에게 넘어간 질문 수"는 `count(*) filter (where not was_deflected)` 여야 한다.
--   (헤드라인 containment_pct 는 matched_entry_ids 기준 별도 계산이라 정확 — 버그는 이 부가 컬럼에 국한.)
--
-- P1-9: served/generated/degraded(폴백) 비율을 여기서 함께 집계한다. 원천은 이미 chat_queries.response_block
--   (jsonb) 에 저장돼 있다(mode='served'|'generated', degraded=true 는 Gemini 실패→mock 폴백).
--   Gemini 키 만료/쿼터로 전 답변이 degraded mock 으로 떨어져도 containment 는 정상처럼 보이던 사각을 없앤다.
--   스키마 변경 없음 — jsonb 경로만 읽는다.
--
-- ⚠️ CREATE OR REPLACE VIEW 는 기존 컬럼의 이름·순서를 바꿀 수 없고 끝에 추가만 허용한다(42P16).
--    새 컬럼(served/generated/degraded)을 논리적 위치에 넣으려면 컬럼 순서가 바뀌므로, 먼저 DROP 후 재생성한다.
--    이 뷰를 참조하는 다른 뷰/함수는 없다(0021 에서 생성되는 독립 리포팅 뷰). 읽기전용·앱 미노출이라 무위험.

drop view if exists public.kpi_containment_weekly;

create view public.kpi_containment_weekly as
select
  date_trunc('week', asked_at at time zone 'Asia/Seoul')::date as week,
  count(*)                                                  as queries_total,
  count(*) filter (where cardinality(matched_entry_ids) > 0) as answered,
  -- 정정(P1-8): 사장에게 넘어간 질문 = AI가 답하지 않은(was_deflected=false) 질문.
  count(*) filter (where not was_deflected)                as deflected_to_owner,
  -- AI 답변 품질 3분할(P1-9) — 저장된 노하우 그대로(served) / AI가 모아 정리(generated) / 폴백(degraded).
  --   served: was_deflected(=AI가 답함) 중 generated 가 아닌 것. mode 키 없는 레거시 행(하위호환상 served)도
  --           여기로 흡수한다(response_block->>'mode' 가 NULL 이면 coalesce 로 'served' 취급). → served+generated=was_deflected.
  count(*) filter (where was_deflected and coalesce(response_block->>'mode', 'served') <> 'generated') as served,
  count(*) filter (where response_block->>'mode' = 'generated')  as generated,
  count(*) filter (where (response_block->>'degraded')::boolean is true) as degraded,
  round(
    100.0 * count(*) filter (where cardinality(matched_entry_ids) > 0)
    / nullif(count(*), 0), 1
  ) as containment_pct,
  -- degraded 비율(%) = "AI 생성 시도 중 mock 폴백 비율". 분모를 generated 로 좁혀야(served 는 LLM 콜 0이라
  --   Gemini 가 죽어도 정상 서빙 → 절대 degraded 아님) Gemini 완전 다운 시 100% 로 치솟아 경보로 작동한다.
  round(
    100.0 * count(*) filter (where (response_block->>'degraded')::boolean is true)
    / nullif(count(*) filter (where response_block->>'mode' = 'generated'), 0), 1
  ) as degraded_pct
from public.chat_queries
group by 1
order by 1 desc;

-- 권한: 앱 클라이언트 노출 금지(테넌트 경계 초월 집계) — 0021 과 동일.
revoke all on public.kpi_containment_weekly from anon, authenticated;
