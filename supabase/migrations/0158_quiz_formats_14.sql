-- 0158_quiz_formats_14.sql — 문항 형태 11종 → 14종 (order_build · scale_pick · branch_path)
--
-- ── 왜 (AGENTS.md ①) ────────────────────────────────────────────────────────
-- 08-24 문항 유형 리서치에서 "형태 30종"이 실제로는 **UI 15종**이고 그중 5종만 코드에 있다는 게
-- 드러났다(기획/ux/퀴즈_문항유형_고도화_2026-08-24.html). 이 파일은 그 1순위 3종을 서버에 여는 것이다.
--   ⑥ order_build  t1 — 섞인 항목을 순서대로 탭. 탭한 자리에 그대로 1·2·3·4 가 붙는다.
--   ⑦ scale_pick   t2 — 값이 다른 혼동쌍 둘 중 큰 쪽. payload 모양은 mc4 계열과 같다.
--   ⑧ branch_path  t5 — 조건이 단계적으로 갈리는 트리. 채점은 도착한 결과가 아니라 **밟아 온 경로**로.
--
-- ── 0125 가 적어 둔 "네 곳" 을 이번에도 전부 고친다 ──────────────────────────
--   ① quiz_known_formats  (0125 → 여기)  11 → 14
--   ② quiz_strip_payload  (0107 → 여기)  공통 제거 목록에 answer_seq · answer_path
--   ③ quiz_grade_item     (0113 → 여기)  선택지형에 scale_pick · 순서배열 분기 신설
--   ④ 자가점검 블록                      아래
-- 클라 쪽 짝: src/lib/quiz/formats/index.ts(FORMATS) · src/components/work/quiz/index.ts(QUIZ_RENDERERS)
--            · supabase/functions/ai/quizFormats.ts(생성 스키마) · PayloadForm.tsx(사장 직접 입력)
-- ★ 이 파일의 형태 수와 클라 FORMATS 의 개수가 다르면 그게 곧 0125 버그의 재발이다.
--
-- ── 라이브 영향 ──────────────────────────────────────────────────────────────
-- 기존 행에 손대지 않는다. 세 형태는 **새로 만들어질 문항부터** 서빙·채점된다.
-- 되돌리려면 quiz_known_formats 를 11종으로 되돌리면 된다(세 형태가 fail-closed 로 빠진다) —
-- ⛔ 단 grade/strip 분기는 지우지 말 것. 0125 가 match_line 에서 그랬듯, 만들 경로만 닫고
--    채점 코드는 남겨야 이미 저장된 행이 조용한 오답이 되지 않는다.
--
-- ★signup-drift ③: 이 세 함수의 최종 정본은 항상 최고 번호 마이그레이션이다 — 여기가 정본이다.



-- ════════════════════════════════════════════════════════════════════════
-- ① 형태 화이트리스트 — 여기 없는 형태는 응시에서 조용히 빠진다(fail-closed)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_known_formats()
returns text[] language sql immutable as $$
  select array[
    'mc4', 'order_pick', 'wrong_spot', 'order_build',
    'value_pick', 'fill_count', 'scale_pick',
    'trap_pick', 'mine_tap',
    'case_pick', 'quick_judge', 'branch_path',
    'name_pick', 'chosung'
  ]
$$;


-- ════════════════════════════════════════════════════════════════════════
-- ② 정답 제거 — denylist 다. 새 형태의 정답 키를 여기 안 넣으면 그대로 새어 나간다
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_strip_payload(p_seed text, p_format text, p_payload jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v       jsonb := coalesce(p_payload, '{}'::jsonb);
  v_new   jsonb;
  v_pairs jsonb;
  v_n     int;
  v_perm  int[];
begin
  -- 공통 제거 목록. 새 형태의 정답 키는 **반드시 여기(또는 아래 형태별 특수 처리)에 추가**한다.
  -- 짝: 각 형태 파일의 stripKeys(src/lib/quiz/formats). 글자 그대로 같아야 한다.
  v := v - 'answer_index' - 'wrong_index' - 'target' - 'answer_seq' - 'answer_path' - 'explain';

  if p_format = 'mine_tap' then
    if jsonb_typeof(v -> 'cards') = 'array' then
      select coalesce(jsonb_agg(c - 'is_mine' order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(v -> 'cards') with ordinality as t(c, ord);
      v := jsonb_set(v, '{cards}', v_new);
    end if;

  elsif p_format = 'quick_judge' then
    if jsonb_typeof(v -> 'cards') = 'array' then
      select coalesce(jsonb_agg(c - 'answer' order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(v -> 'cards') with ordinality as t(c, ord);
      v := jsonb_set(v, '{cards}', v_new);
    end if;

  elsif p_format = 'match_line' then
    v_pairs := v -> 'pairs';
    v := v - 'pairs';
    if jsonb_typeof(v_pairs) = 'array' then
      v_n := jsonb_array_length(v_pairs);
      v_perm := public.quiz_right_perm(p_seed, v_n);
      select coalesce(jsonb_agg(p -> 'left' order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(v_pairs) with ordinality as t(p, ord);
      v := jsonb_set(v, '{lefts}', v_new, true);
      select coalesce(jsonb_agg(v_pairs -> (v_perm[k]) -> 'right' order by k), '[]'::jsonb)
        into v_new
        from generate_series(1, v_n) k;
      v := jsonb_set(v, '{rights}', v_new, true);
    end if;
  end if;

  return v;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- ③ 채점 — 선택지형에 scale_pick 추가 · 순서 있는 정수 배열 분기 신설
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_grade_item(p_item_id text, p_unit_id text, p_response jsonb)
returns table (correct boolean, explain text, answer jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r         public.quiz_items%rowtype;
  v_ok      boolean;
  v_answer  jsonb;
  v_expect  int[];
  v_got     int[];
  v_n       int;
  v_perm    int[];
  v_key     text;
begin
  if p_unit_id is null then raise exception 'no_unit'; end if;

  select * into r
    from public.quiz_items q
   where q.id = p_item_id and q.unit_id = p_unit_id and q.status = 'active';
  if not found then raise exception 'item_not_found'; end if;

  -- ── 선택지 하나 고르는 형태 ─────────────────────────────────────────────
  -- ⚠️ SQL 의 and 는 단축평가를 보장하지 않는다 → 타입 검사 뒤에 캐스팅을 두면 안 되고
  --    case 로 분기해야 한다(문자열 응답이 오면 캐스팅 예외로 채점 자체가 죽는다).
  --    비교는 ::numeric — 모델이 1 대신 1.0 을 뱉어도 같은 값으로 본다(::int 는 1.5 에서 터진다).
  if r.format in ('mc4', 'order_pick', 'value_pick', 'trap_pick', 'pair_pick', 'case_pick',
                 'name_pick', 'chosung', 'scale_pick') then
    if not (r.payload ? 'answer_index') then raise exception 'malformed_item:answer_index %', r.id; end if;
    v_answer := r.payload -> 'answer_index';
    v_ok := case when jsonb_typeof(p_response) = 'number'
                 then (p_response #>> '{}')::numeric = (r.payload ->> 'answer_index')::numeric
                 else false end;

  elsif r.format = 'wrong_spot' then
    if not (r.payload ? 'wrong_index') then raise exception 'malformed_item:wrong_index %', r.id; end if;
    v_answer := r.payload -> 'wrong_index';
    v_ok := case when jsonb_typeof(p_response) = 'number'
                 then (p_response #>> '{}')::numeric = (r.payload ->> 'wrong_index')::numeric
                 else false end;

  elsif r.format = 'fill_count' then
    if not (r.payload ? 'target') then raise exception 'malformed_item:target %', r.id; end if;
    v_answer := r.payload -> 'target';
    v_ok := case when jsonb_typeof(p_response) = 'number'
                 then (p_response #>> '{}')::numeric = (r.payload ->> 'target')::numeric
                 else false end;

  -- ── 순서 있는 정수 배열: order_build(누른 순서) · branch_path(예=0·아니요=1 경로) ──
  -- ★★ mine_tap 과 헷갈리지 말 것. 저쪽은 **집합**이라 정렬·중복제거 후 비교하지만, 여기는
  --    **순서가 곧 답**이다. distinct 나 order by 값 을 넣는 순간 뒤집힌 답이 정답이 된다.
  elsif r.format in ('order_build', 'branch_path') then
    v_key := case r.format when 'order_build' then 'answer_seq' else 'answer_path' end;
    if not (r.payload ? v_key) then raise exception 'malformed_item:% %', v_key, r.id; end if;
    v_answer := r.payload -> v_key;
    -- 정답 쪽이 깨졌으면 조용히 오답 처리하지 않는다 — "왜 다 틀리지?"의 원인을 못 찾게 된다.
    if jsonb_typeof(v_answer) <> 'array'
       or exists (select 1 from jsonb_array_elements(v_answer) e where jsonb_typeof(e) <> 'number') then
      raise exception 'malformed_item:% %', v_key, r.id;
    end if;
    select coalesce(array_agg((e #>> '{}')::numeric::int order by ord), '{}'::int[])
      into v_expect
      from jsonb_array_elements(v_answer) with ordinality as t(e, ord);
    if jsonb_typeof(p_response) <> 'array'
       or exists (select 1 from jsonb_array_elements(p_response) e where jsonb_typeof(e) <> 'number') then
      v_ok := false;
    else
      select coalesce(array_agg((e #>> '{}')::numeric::int order by ord), '{}'::int[])
        into v_got
        from jsonb_array_elements(p_response) with ordinality as t(e, ord);
      v_ok := coalesce(v_got = v_expect, false);
    end if;

  -- ── 지뢰 밟기: 탭한 index 집합 == is_mine 인 index 집합 (부분점수 없음) ──
  elsif r.format = 'mine_tap' then
    if jsonb_typeof(r.payload -> 'cards') <> 'array' then raise exception 'malformed_item:cards %', r.id; end if;
    select coalesce(array_agg((ord - 1)::int order by ord), '{}'::int[])
      into v_expect
      from jsonb_array_elements(r.payload -> 'cards') with ordinality as t(c, ord)
     where (c ->> 'is_mine')::boolean is true;
    v_answer := to_jsonb(v_expect);
    if jsonb_typeof(p_response) <> 'array'
       or exists (select 1 from jsonb_array_elements(p_response) e where jsonb_typeof(e) <> 'number') then
      v_ok := false;
    else
      select coalesce(array_agg(distinct (e #>> '{}')::numeric::int), '{}'::int[])
        into v_got
        from jsonb_array_elements(p_response) e;
      v_ok := coalesce(v_got = v_expect, false);   -- 양쪽 다 오름차순·중복 제거된 배열
    end if;

  -- ── 빠른 판별: 카드마다 고른 값이 cards[i].answer 와 전부 일치 ───────────
  elsif r.format = 'quick_judge' then
    if jsonb_typeof(r.payload -> 'cards') <> 'array' then raise exception 'malformed_item:cards %', r.id; end if;
    if exists (select 1 from jsonb_array_elements(r.payload -> 'cards') c where not (c ? 'answer')) then
      raise exception 'malformed_item:cards[].answer %', r.id;   -- 정답 없는 카드를 오답 처리하면 원인 추적 불가
    end if;
    select coalesce(jsonb_agg(c -> 'answer' order by ord), '[]'::jsonb)
      into v_answer
      from jsonb_array_elements(r.payload -> 'cards') with ordinality as t(c, ord);
    if jsonb_typeof(p_response) <> 'array'
       or jsonb_array_length(p_response) <> jsonb_array_length(r.payload -> 'cards') then
      v_ok := false;
    else
      -- jsonb 끼리 직접 비교 — 캐스팅이 없어 어떤 응답이 와도 예외가 나지 않는다.
      select coalesce(bool_and((p_response -> ((ord - 1)::int)) = (c -> 'answer')), false)
        into v_ok
        from jsonb_array_elements(r.payload -> 'cards') with ordinality as t(c, ord);
      v_ok := coalesce(v_ok, false);
    end if;

  -- ── 줄 잇기: 섞인 자리 → 원본 index 복원 후 항등 검사 (0107 §5 좌표계 주석 참조) ──
  elsif r.format = 'match_line' then
    if jsonb_typeof(r.payload -> 'pairs') <> 'array' then raise exception 'malformed_item:pairs %', r.id; end if;
    v_n := jsonb_array_length(r.payload -> 'pairs');
    v_perm := public.quiz_right_perm(public.quiz_shuffle_seed(r.id, r.created_at), v_n);
    -- 정답 표기도 클라 좌표계로: 왼쪽 원본 i → 그 오른쪽이 놓인 섞인 자리.
    select coalesce(jsonb_object_agg((v_perm[k])::text, to_jsonb(k - 1)), '{}'::jsonb)
      into v_answer
      from generate_series(1, v_n) k;
    if jsonb_typeof(p_response) <> 'object'
       or exists (select 1 from jsonb_each(p_response) kv where jsonb_typeof(kv.value) <> 'number') then
      v_ok := false;
    else
      -- 값이 범위를 벗어나면 배열 첨자가 null 을 주고 bool_and 가 null → coalesce false.
      select coalesce(count(*) = v_n and bool_and(v_perm[((p_response ->> i::text)::numeric::int) + 1] = i), false)
        into v_ok
        from generate_series(0, v_n - 1) i
       where p_response ? i::text;
      v_ok := coalesce(v_ok, false);
    end if;

  else
    -- 레지스트리에 없는 형태를 조용히 오답 처리하면 "왜 다 틀리지?"의 원인을 영원히 못 찾는다.
    raise exception 'unknown_quiz_format:% (item %)', r.format, r.id;
  end if;

  return query
    select v_ok,
           coalesce(r.payload ->> 'explain', ''),
           case when v_ok then null::jsonb else v_answer end;   -- 정답은 틀렸을 때만 알려준다
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- ④ 자가 점검 — 목록이 다시 벌어지거나 정답이 새면 여기서 멈춘다
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v jsonb;
  f text[] := public.quiz_known_formats();
  s text := public.quiz_shuffle_seed('qi_selftest', '2026-08-24 00:00:00+00'::timestamptz);
begin
  if array_length(f, 1) <> 14 then
    raise exception 'quiz_known_formats must list exactly 14 formats (got %)', array_length(f, 1);
  end if;
  if 'pair_pick' = any(f) or 'match_line' = any(f) then
    raise exception 't4 formats must not be served (2026-08-08 폐기): %', f;
  end if;
  if not ('order_build' = any(f) and 'scale_pick' = any(f) and 'branch_path' = any(f)) then
    raise exception '0158 formats missing from whitelist: %', f;
  end if;

  -- order_build: answer_seq 가 사라지고 items 는 그대로 남아야 한다(남지 않으면 화면이 빈다)
  v := public.quiz_strip_payload(s, 'order_build',
       '{"ask":"a","items":["i0","i1","i2"],"answer_seq":[2,0,1],"explain":"e"}'::jsonb);
  if v ?| array['answer_seq', 'explain'] then raise exception 'strip leak order_build: %', v; end if;
  if jsonb_array_length(v -> 'items') <> 3 then raise exception 'strip broke order_build items: %', v; end if;

  -- scale_pick: 선택지형과 같은 모양 — answer_index 가 사라져야 한다
  v := public.quiz_strip_payload(s, 'scale_pick',
       '{"ask":"a","choices":["L","R"],"unit":"펌프","answer_index":1,"explain":"e"}'::jsonb);
  if v ?| array['answer_index', 'explain'] then raise exception 'strip leak scale_pick: %', v; end if;
  if not (v ? 'unit') then raise exception 'strip broke scale_pick unit: %', v; end if;

  -- branch_path: answer_path 가 사라지고 트리(steps·results)는 남아야 한다
  -- ★ 괄호 필수 — `::` 가 `||` 보다 먼저 묶여서 뒤 조각만 캐스팅되면 JSON 이 깨진다(첫 적용에서 실제로 났다).
  v := public.quiz_strip_payload(s, 'branch_path',
       ('{"ask":"a","steps":[{"ask":"q0","yes":"s1","no":"r0"},{"ask":"q1","yes":"r1","no":"r0"}],'
        || '"results":["r0text","r1text"],"answer_path":[0,0],"explain":"e"}')::jsonb);
  if v ?| array['answer_path', 'explain'] then raise exception 'strip leak branch_path: %', v; end if;
  if jsonb_array_length(v -> 'steps') <> 2 or jsonb_array_length(v -> 'results') <> 2 then
    raise exception 'strip broke branch_path tree: %', v;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 권한 재확인 — create or replace 는 기존 ACL 을 보존하지만, 이 둘은 새면 곧 정답 유출이라
-- 매번 명시적으로 다시 닫는다(0107·0113 과 같은 이유). 이미 닫혀 있으면 아무 일도 하지 않는다.
-- ════════════════════════════════════════════════════════════════════════
revoke all on function public.quiz_strip_payload(text, text, jsonb) from public;
revoke all on function public.quiz_grade_item(text, text, jsonb) from public;
