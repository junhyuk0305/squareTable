-- 0125_quiz_known_formats_11.sql — 서버 형태 화이트리스트를 클라 레지스트리(11종)와 맞춘다
--
-- ── 증상 → 구조 (AGENTS.md ①) ────────────────────────────────────────────────
-- 2026-08-08 '멘트'(action.scripts) 폐기 때 퀴즈 t4 도 같이 없앴다 — 클라에서 `pair_pick`·`match_line`
-- 의 형태 파일·렌더러·타입을 전부 지웠다(FORMATS 13 → 11종).
-- 그런데 **서버 화이트리스트 quiz_known_formats() 만 13종 그대로 남았다.** 형태 목록이
-- 클라(레지스트리)와 서버(이 함수) 두 곳에 복제된 구조라 한쪽만 고쳐진 것이다.
--
-- 그 결과가 0109 가 스스로 경고해 둔 바로 그 상태다:
--   "세는 기준은 quiz_items_for 가 실제로 서빙하는 조건과 같아야 한다 — 다르면 '있다고 했는데 안 나온다'"
--   · quiz_item_counts()  → 13종을 센다 → 직원 카드가 "문항 있음"으로 뜬다
--   · quiz_items_for()    → 13종을 서빙한다
--   · 클라               → QUIZ_RENDERERS 에 없는 형태를 걸러낸다(UnderstandingCheckSheet.tsx:90)
--                          → 남는 게 0건이면 "아직 이 업무의 퀴즈가 준비되지 않았어요"
--   = 개수는 "있다"는데 응시는 0건.
--
-- ★정답 유출은 아니다. 유령 형태도 quiz_strip_payload 를 타고 나가므로 정답 키는 제거된 상태였다
--  (2026-08-11 P6 QA 에서 응답 원문으로 확인). 이 파일은 **정합성** 수정이지 보안 수정이 아니다.
--
-- ── 라이브 영향 ──────────────────────────────────────────────────────────────
-- 적용 시점 실 데이터: match_line 24행 · pair_pick 1행 — **전부 QA 잔여 매장**('TR 훈련매장'·'TR 퀴즈매장').
-- 실 매장 0건이라 이 변경으로 사라지는 사용자 문항은 없다.
--
-- ⛔ 0107·0113 의 match_line **채점 분기는 건드리지 않는다.** 만들 경로가 없어 도달 불가일 뿐
--    문법적으로 유효하고, 지우면 옛 행을 되살릴 때 조용한 오답이 된다 — 일부러 남긴 코드다.
--    여기서는 "서빙·집계 대상에서 뺀다"만 한다 → 두 형태는 fail-closed 로 빠진다.
--
-- ★signup-drift ③: 이 함수의 최종 정본은 항상 최고 번호 마이그레이션이다 — 여기가 정본이다.

create or replace function public.quiz_known_formats()
returns text[] language sql immutable as $$
  select array[
    'mc4', 'order_pick', 'wrong_spot', 'value_pick', 'fill_count',
    'trap_pick', 'mine_tap', 'case_pick', 'quick_judge', 'name_pick', 'chosung'
  ]
$$;
-- ⚠️ 형태를 추가하면 네 곳을 함께 고친다(0113 §3 주석과 같은 목록):
--    ① 이 함수 ② quiz_strip_payload(0107) ③ quiz_grade_item(0113) ④ 0107 끝의 자가점검 블록
--    그리고 클라 src/lib/quiz/formats/index.ts FORMATS + src/components/work/quiz/index.ts
--    QUIZ_RENDERERS. **이 파일과 클라 FORMATS 의 개수가 다르면 그게 곧 이 버그의 재발이다.**

-- ════════════════════════════════════════════════════════════════════════
-- 자가 점검 — 목록이 다시 벌어지면 여기서 멈춘다
-- ════════════════════════════════════════════════════════════════════════
do $$
declare v text[] := public.quiz_known_formats();
begin
  if array_length(v, 1) <> 11 then
    raise exception 'quiz_known_formats must list exactly 11 formats (got %)', array_length(v, 1);
  end if;
  if 'pair_pick' = any(v) or 'match_line' = any(v) then
    raise exception 't4 formats must not be served (2026-08-08 폐기): %', v;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- quiz_items.entry_ids 의 소유 검사 — **의도적으로 안 한다**(P6-#3, 2026-08-11 결정)
-- ════════════════════════════════════════════════════════════════════════
-- 같은 "text FK 는 존재만 검사한다" 문제를 course_entries(0111) · knowhow_understanding(0111) ·
-- quiz_attempts(0112) · quiz_links(0113) 는 전부 `exists(… and unit_id = …)` 로 막았다.
-- quiz_items.entry_ids 만 예외다 — 구멍을 못 본 게 아니라 **막지 않기로 한 것**이라 여기 남긴다.
--
-- 왜 안 막나:
--   · 새는 게 없다. payload 는 문항을 만드는 사람이 직접 쓴 것이라 남의 매장 내용이 들어올 수 없고,
--     조회(quiz_items_for)는 q.unit_id = 내 매장으로 이미 잠겨 있다.
--   · 유일한 탐지 통로였던 "남의 노하우 updated_at 떠보기"는 0114 스탬프 트리거가
--     `pe.unit_id = new.unit_id` 로 막아 source_updated_at 이 null 로 떨어진다(실측 확인).
--   · entry_ids 는 text[] 라 FK 가 불가능하고, 정책에서 막으려면 쓰기마다 unnest 전수 검사가 붙는다.
--     얻는 것(이미 닫힌 경로) 대비 비용이 크다.
-- 되돌리려면(=막기로 결정하면) qi_insert/qi_update 의 with check 에 아래를 더한다:
--   and not exists (select 1 from unnest(entry_ids) as e(eid)
--                    where not exists (select 1 from public.playbook_entries pe
--                                       where pe.id = e.eid and pe.unit_id = unit_id))
comment on column public.quiz_items.entry_ids is
  '근거 노하우 id 배열(text[] 라 FK 불가). ★소유를 검사하지 않는다 — 0125 에서 "안 막는다"로 결정.
   남의 매장 노하우 id 를 넣어도 내용은 새지 않고(payload 는 작성자가 쓴 것) 갱신 시각도 0114 트리거가 막는다.
   구멍이 아니라 결정이다 — 막으려면 0125 주석의 unnest 전수 검사를 쓴다.';
