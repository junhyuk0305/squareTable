-- 0183_quiz_drop_mark_paragraph.sql — 형태 하나를 출제에서 뺀다 (18종 → 17종)
--
-- ■ 왜 빼나 (2026-08-27 실측 — scripts/qa-quiz-gen.mjs)
-- `mark_paragraph`(잘못된 곳 짚기)는 **서로 다른 재료로 3번 물어 3번 다 모델이 빈 배열을 돌려줬다.**
-- 엣지가 형태를 몰라서가 아니다 — 응답에 usage 가 찍혔다(= 모델을 실제로 불렀다). 지시에 조건이
-- 7개인데 "규정과 대조할 것이 노하우에 없으면 출제하지 마라"는 퇴로까지 있어 모델이 늘 그리로 갔다.
--
-- 그런데 pickFormats 는 노하우 40건 중 **24건(60%)** 을 이 형태에 배정하고 있었다.
-- 안전판(generateQuizItems 의 일반형 재시도)이 덮어 사장이 빈손이 되지는 않았지만 —
-- 자동 경로 실측: mark_paragraph 실패 → trap_pick 으로 떨어져 문항 1개 생성 —
-- **그때마다 AI 캡을 1회 버렸다**(무료 요금제는 월 150회).
--
-- 살리는 쪽(프롬프트 수정)이 아니라 빼는 쪽을 택했다(사용자 확정 2026-08-27).
--
-- ■ 무엇을 하나
-- ① 기존 active 문항을 archived 로 내린다.  ★먼저 한다. 화이트리스트에서만 빼면 문항이
--    응시에서 조용히 사라지고(fail-closed) 사장은 왜 없어졌는지 알 길이 없다.
-- ② quiz_known_formats 에서 뺀다 — 여기가 스위치다. 신규 출제·응시 배포가 여기서 막힌다.
--
-- ■ 무엇을 **하지 않나** — ★이게 이 파일에서 제일 중요하다
-- `quiz_grade_item` · `quiz_strip_payload` 의 mark_paragraph 분기는 **건드리지 않는다**(0170 이 정본).
--   · 이미 배포된 네이티브 앱과 이미 발송된 게스트 링크가 그 형태의 채점을 요청할 수 있다
--   · quiz_attempt_items(지난 응시 기록)를 사장 문항별 상세가 다시 그릴 때 strip 을 탄다
-- 지우면 0161 이 quick_judge 에서 낸 사고("목록엔 있는데 채점만 죽는다")를 방향만 바꿔 재현한다.
-- 남겨 두는 비용은 0이다 — 0170 의 자가점검은 "화이트리스트의 형태가 채점 본문에 있는가"만 보므로
-- 화이트리스트에 없는 분기가 남아 있어도 통과한다.
--
-- 스키마 변경 0건. 함수 본문 하나 + 데이터 정리.

-- ════════════════════════════════════════════════════════════════════════
-- ① 기존 문항을 내린다 (화이트리스트를 건드리기 **전에**)
-- ════════════════════════════════════════════════════════════════════════
update public.quiz_items
   set status = 'archived', updated_at = now()
 where format = 'mark_paragraph'
   and status = 'active';

-- ════════════════════════════════════════════════════════════════════════
-- ② 화이트리스트 — 17종. 0168 본문에서 'mark_paragraph' 한 줄만 뺀다
--    (최고 번호가 정본 — AGENTS.md ⑧. 본문을 옮길 때 나열 순서도 그대로 옮긴다.)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_known_formats()
returns text[] language sql immutable as $$
  select array[
    'mc4', 'order_pick', 'wrong_spot', 'order_build',
    'value_pick', 'fill_count', 'scale_pick', 'numeric_entry',
    'trap_pick', 'mine_tap',
    'flip_match', 'link_match',
    'case_pick', 'quick_judge', 'branch_path',
    'name_pick', 'chosung'
  ]
$$;

-- ════════════════════════════════════════════════════════════════════════
-- ③ 자가 점검 — **개수만 세지 않는다**
--
--   0158·0161·0168 의 "N종" 검사는 quick_judge 의 채점 누락을 전부 통과시켰다(목록에 이름이
--   남아 있으면 초록이라서). 여기서는 개수에 더해 **동작 세 가지**를 잰다:
--     ㉮ 빠진 형태가 정말 목록에서 사라졌나
--     ㉯ 남은 17종이 하나도 안 사라졌나(재정의하며 한 줄 빠뜨리는 사고가 실제로 잦다)
--     ㉰ ★빠진 형태의 **채점·strip 은 여전히 도는가** — 이 파일의 핵심 의도이자, 지난 응시
--        기록과 이미 배포된 앱을 지키는 유일한 방어선이다. 다음 사람이 "안 쓰는 분기니까"
--        하고 지우면 여기서 멈춘다.
--     ㉱ 내려야 할 문항이 남지 않았나
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  f       text[] := public.quiz_known_formats();
  v_def   text := pg_get_functiondef('public.quiz_grade_item(text, text, jsonb)'::regprocedure);
  v_strip jsonb;
  v_left  int;
  k       text;
begin
  -- ㉮
  if 'mark_paragraph' = any(f) then
    raise exception 'mark_paragraph 가 아직 화이트리스트에 있다: %', f;
  end if;
  if array_length(f, 1) <> 17 then
    raise exception 'quiz_known_formats must list exactly 17 formats (got %)', array_length(f, 1);
  end if;

  -- ㉯ 남아야 할 것이 전부 있는지 이름으로 확인한다(개수만 맞고 다른 게 빠질 수 있다).
  foreach k in array array[
    'mc4', 'order_pick', 'wrong_spot', 'order_build', 'value_pick', 'fill_count',
    'scale_pick', 'numeric_entry', 'trap_pick', 'mine_tap', 'flip_match', 'link_match',
    'case_pick', 'quick_judge', 'branch_path', 'name_pick', 'chosung'
  ] loop
    if not (k = any(f)) then
      raise exception '남아 있어야 할 형태가 화이트리스트에서 사라졌다: %', k;
    end if;
  end loop;

  -- ㉯-2 화이트리스트의 형태는 전부 채점 분기가 있어야 한다(0170 과 같은 검사).
  foreach k in array f loop
    if position('''' || k || '''' in v_def) = 0 then
      raise exception '채점 분기가 없는 형태가 화이트리스트에 있다: %', k;
    end if;
  end loop;

  -- ㉰ ★뺀 형태의 채점·strip 은 **살아 있어야 한다**. 지운 순간 지난 응시 기록이 깨지고,
  --    이미 배포된 앱이 보낸 채점 요청이 unknown_quiz_format 으로 죽는다.
  if position('''mark_paragraph''' in v_def) = 0 then
    raise exception
      'mark_paragraph 의 채점 분기가 사라졌다 — 출제에서만 빼고 채점은 남겨야 한다(0183 주석 참조)';
  end if;
  v_strip := public.quiz_strip_payload(
               'seed', 'mark_paragraph',
               ('{"ask":"어디가 규정과 다른가","parts":['
                || '{"text":"포스 정산부터 하고","tap":true,"is_wrong":false},'
                || '{"text":"바닥부터 쓸었어요","tap":true,"is_wrong":true}'
                || '],"explain":"x"}')::jsonb);
  if exists (select 1 from jsonb_array_elements(v_strip -> 'parts') p where p ? 'is_wrong') then
    raise exception 'mark_paragraph 의 strip 이 깨졌다 — 지난 기록에서 정답이 샌다: %', v_strip;
  end if;

  -- ㉱ 내려야 할 문항이 남지 않았나
  select count(*) into v_left
    from public.quiz_items
   where format = 'mark_paragraph' and status = 'active';
  if v_left > 0 then
    raise exception '아직 active 인 mark_paragraph 문항이 %건 남아 있다', v_left;
  end if;
end $$;
