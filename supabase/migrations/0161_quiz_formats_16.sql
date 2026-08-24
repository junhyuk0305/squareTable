-- 0161_quiz_formats_16.sql — 문항 형태 14종 → 16종 (flip_match · link_match, 둘 다 t4 대응)
--
-- ── 왜 (AGENTS.md ①) ────────────────────────────────────────────────────────
-- 08-24 문항 유형 카탈로그(기획/ux/퀴즈_문항유형_고도화_2026-08-24.html)의 ⑨·⑩ 을 연다.
--   ⑨ flip_match  t4 — 카드 두 장을 뒤집어 짝이면 고정, 아니면 다시 덮인다(매칭 게임 표준 로직).
--   ⑩ link_match  t4 — 왼쪽 탭 → 오른쪽 탭으로 한 쌍. 이은 자리에 실제로 선이 그어진다(드래그 없음).
--
-- t4(대응)는 2026-08-08 멘트(action.scripts) 폐기 때 재료가 사라져 함께 닫혔다(0125).
-- 이번에 되살리는 근거는 재료가 바뀌었다는 것이다 — 멘트가 아니라 **노하우가 직접 적는 짝**
-- (물건↔두는 자리, 용어↔뜻)이다. ⛔ 그때 닫은 pair_pick·match_line 은 되살리지 않는다.
--
-- ── 0158 이 적어 둔 "네 곳"을 이번에도 전부 고친다 ──────────────────────────
--   ① quiz_known_formats  (0158 → 여기)  14 → 16
--   ② quiz_strip_payload  (0158 → 여기)  flip_match 분해 신설 · link_match 를 match_line 분기에 합류
--   ③ quiz_grade_item     (0159 → 여기)  flip_match 채점 신설 · link_match 를 match_line 분기에 합류
--   ④ 자가점검 블록                      아래 ⑤
-- 클라 쪽 짝: src/lib/quiz/formats/index.ts(FORMATS) · src/components/work/quiz/index.ts(QUIZ_RENDERERS)
--            · supabase/functions/ai/quizFormats.ts(생성 스키마) · PayloadForm.tsx shapeOf(사장 직접 입력)
--
-- ★signup-drift ③: quiz_strip_payload · quiz_grade_item 의 최종 정본은 항상 최고 번호 마이그레이션이다
--   — 여기가 정본이다(0107 → 0113 → 0158 → 0159 → 여기).
--
-- ── ★★ link_match 는 왜 새 코드가 거의 없나 ────────────────────────────────
-- 폐기된 match_line 과 **좌표계가 완전히 같다**: pairs 를 lefts(원본 순서) + rights(결정적 셔플)로
-- 분해하고, 응답은 {"왼쪽 원본 index": "오른쪽이 놓인 섞인 자리"} 객체다. 0125 가 "만들 경로만 닫고
-- 채점 코드는 남긴다"고 해 둔 덕분에 그 분기에 이름 한 줄만 더하면 된다. 손가락 동작(탭-탭)과
-- 그리는 선은 클라의 일이고, 서버가 보는 데이터는 같다.
--
-- ── ★★★ flip_match 는 정답 유출 규칙의 **의도된 예외**다. 반드시 읽을 것 ────
-- 매칭 게임은 "지금 뒤집은 두 장이 짝인가"를 **화면이 그 자리에서** 판정해야 성립한다.
-- 서버에 물어보러 갈 시간이 없다 → 응시 payload 에 어느 카드끼리 짝인지가 들어가야 한다.
-- 그래서 strip 은 pairs 를 지우되 `cards[].group`(같은 숫자 = 같은 짝)을 남긴다.
--   · 다른 형태처럼 감출 방법이 **없다.** 자동 채점을 포기하거나 형태를 포기하거나 둘 중 하나다.
--   · 대신 이 형태는 등수를 매기는 문항이 아니다(07-29 가 "반복 노출로 저절로 외워지는" 형태로 지목).
--     정직하게 끝까지 뒤집으면 항상 맞는다. 서버 채점이 잡는 것은 "판을 실제로 끝냈는가" 뿐이다 —
--     짝이 아닌 둘을 묶었거나, 카드를 빠뜨렸거나 두 번 쓴 응답은 오답이다.
--   · ⛔ 이 예외를 다른 형태로 복사하지 말 것. 나머지 15종은 정답 키가 절대 내려가지 않는다.
--   · qa-training ⑦C 는 이 사실을 **감추지 않고 그대로 실증한다**(cards[].group 이 남는지 확인한다).
--
-- ── 라이브 영향 ──────────────────────────────────────────────────────────────
-- 기존 행에 손대지 않는다. 두 형태는 **새로 만들어질 문항부터** 서빙·채점된다.
-- 되돌리려면 quiz_known_formats 를 14종으로 되돌리면 된다(두 형태가 fail-closed 로 빠진다) —
-- ⛔ 단 grade/strip 분기는 지우지 말 것(0125 가 match_line 에서 그랬듯 만들 경로만 닫는다).
--
-- ── ⚠️ 0159 의 "14종" 자가점검은 일부러 그대로 두었다 ────────────────────────
-- 0159 끝 블록은 `array_length(...) <> 14` 를 본다. 그걸 16 으로 고치면 **빈 DB 재생성이 깨진다** —
-- 재생성 순서는 0158(14종 설치) → 0159(검사) → 0161(16종) 이라, 0159 시점의 정답은 여전히 14 다.
-- 이미 적용된 마이그레이션은 다시 돌지 않으므로 원격에도 영향이 없다. 개수 검사는 여기 ⑤가 이어받는다.



-- ════════════════════════════════════════════════════════════════════════
-- ① 형태 화이트리스트 — 여기 없는 형태는 응시에서 조용히 빠진다(fail-closed)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_known_formats()
returns text[] language sql immutable as $$
  select array[
    'mc4', 'order_pick', 'wrong_spot', 'order_build',
    'value_pick', 'fill_count', 'scale_pick',
    'trap_pick', 'mine_tap',
    'flip_match', 'link_match',
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

  -- ── 뒤집기(0161): pairs 제거 → cards[](결정적 셔플) 로 분해. group 은 **일부러 남긴다**(위 주석) ──
  -- 카드 원본 번호 c 는 c/2 = 짝 번호, c%2 = 0 이면 left · 1 이면 right.
  elsif p_format = 'flip_match' then
    v_pairs := v -> 'pairs';
    v := v - 'pairs';
    if jsonb_typeof(v_pairs) = 'array' then
      v_n := jsonb_array_length(v_pairs) * 2;                  -- 카드 수
      v_perm := public.quiz_right_perm(p_seed, v_n);           -- 섞인 자리 k-1 → 카드 원본 번호
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'text', case when v_perm[k] % 2 = 0
                              then v_pairs -> (v_perm[k] / 2) -> 'left'
                              else v_pairs -> (v_perm[k] / 2) -> 'right' end,
                 'group', v_perm[k] / 2)
               order by k), '[]'::jsonb)
        into v_new
        from generate_series(1, v_n) k;
      v := jsonb_set(v, '{cards}', v_new, true);
    end if;

  -- ── 줄 잇기: match_line 과 완전히 같은 분해(0107 §3) — link_match 가 그 좌표계를 그대로 쓴다 ──
  elsif p_format in ('match_line', 'link_match') then
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
-- ③ 채점 — flip_match 신설 · link_match 를 match_line 분기에 합류
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
  v_cards   jsonb;
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
    -- ★ 길이부터 본다(0159). p_response 는 **익명 호출자가 통째로 정하는 값**이라, 길이가 안 맞는
    --   배열을 먼저 걸러내지 않으면 20만 칸짜리 응답도 전부 집계한 뒤에야 틀렸다고 말하게 된다.
    --   quick_judge 가 같은 이유로 카드 수를 먼저 본다 — 같은 순서를 지킨다.
    if jsonb_typeof(p_response) <> 'array'
       or jsonb_array_length(p_response) <> jsonb_array_length(v_answer)
       or exists (select 1 from jsonb_array_elements(p_response) e where jsonb_typeof(e) <> 'number') then
      v_ok := false;
    else
      select coalesce(array_agg((e #>> '{}')::numeric::int order by ord), '{}'::int[])
        into v_expect
        from jsonb_array_elements(v_answer) with ordinality as t(e, ord);
      select coalesce(array_agg((e #>> '{}')::numeric::int order by ord), '{}'::int[])
        into v_got
        from jsonb_array_elements(p_response) with ordinality as t(e, ord);
      v_ok := coalesce(v_got = v_expect, false);
    end if;
    -- 오답일 때 정답을 알려주는 아래 공통 경로가 v_answer(jsonb 원본)를 그대로 쓴다 — 여기서 안 만진다.

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

  -- ── 뒤집어 짝 찾기(0161): 응답 = 짝으로 고정한 순서대로의 **응시용 카드 index**(a1,b1,a2,b2,…) ──
  -- ★ 응시 화면이 받은 cards 는 섞인 것이다 → 여기서도 같은 시드로 strip 을 한 번 더 돌려
  --   **화면이 본 것과 똑같은 배열**을 만든 뒤 그 group 으로 판정한다. 순열을 손으로 되돌리지 않는다
  --   (0107 §5 가 경고하는 좌표계 실수를 만들 자리를 아예 없앤다).
  -- ★ 이 형태는 정직하게 끝까지 뒤집으면 항상 맞는다. 여기서 잡는 것은 "판을 실제로 끝냈는가" 뿐이다.
  elsif r.format = 'flip_match' then
    if jsonb_typeof(r.payload -> 'pairs') <> 'array' then raise exception 'malformed_item:pairs %', r.id; end if;
    v_cards := public.quiz_strip_payload(
                 public.quiz_shuffle_seed(r.id, r.created_at), 'flip_match', r.payload) -> 'cards';
    v_n := coalesce(jsonb_array_length(v_cards), 0);
    if v_n = 0 then raise exception 'malformed_item:pairs %', r.id; end if;
    -- 정답 표기도 클라 좌표계로: 같은 group 끼리 붙여 놓은 카드 index 나열.
    select coalesce(jsonb_agg(to_jsonb(ord - 1) order by (c ->> 'group')::int, ord), '[]'::jsonb)
      into v_answer
      from jsonb_array_elements(v_cards) with ordinality as t(c, ord);
    if jsonb_typeof(p_response) <> 'array'
       or jsonb_array_length(p_response) <> v_n
       or exists (select 1 from jsonb_array_elements(p_response) e where jsonb_typeof(e) <> 'number') then
      v_ok := false;
    else
      select coalesce(array_agg(distinct (e #>> '{}')::numeric::int), '{}'::int[])
        into v_got
        from jsonb_array_elements(p_response) e;
      -- 모든 카드를 한 번씩 썼는가(0..n-1 의 순열인가). 중복·범위 밖이 여기서 걸린다.
      if coalesce(array_length(v_got, 1), 0) <> v_n or v_got[1] <> 0 or v_got[v_n] <> v_n - 1 then
        v_ok := false;
      else
        select coalesce(bool_and(
                 (v_cards -> ((p_response ->> (2 * k))::numeric::int) ->> 'group')
               = (v_cards -> ((p_response ->> (2 * k + 1))::numeric::int) ->> 'group')), false)
          into v_ok
          from generate_series(0, v_n / 2 - 1) k;
        v_ok := coalesce(v_ok, false);
      end if;
    end if;

  -- ── 줄 잇기: 섞인 자리 → 원본 index 복원 후 항등 검사 (0107 §5 좌표계 주석 참조) ──
  --    link_match(0161)가 match_line 과 같은 좌표계를 그대로 쓴다.
  elsif r.format in ('match_line', 'link_match') then
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
-- ④ 권한 재회수 — create or replace 는 ACL 을 보존하지만 "보존됐겠지"에 기대지 않는다(0159 ①)
-- ════════════════════════════════════════════════════════════════════════
-- ★ `from public` 만으로는 안 닫힌다. Supabase 는 anon·authenticated 에 EXECUTE 를 **직접** 부여하고,
--   PUBLIC 회수는 그 직접 부여분을 건드리지 못한다(0159 가 5개월 만에 찾아낸 것). 셋 다 적는다.
-- ⛔ service_role 과 소유자(postgres)는 건드리지 않는다 — definer 실행과 운영 도구가 이걸 쓴다.
revoke all on function public.quiz_strip_payload(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.quiz_grade_item(text, text, jsonb)    from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⑤ 자가 점검 — 목록이 다시 벌어지거나 정답이 새면 여기서 멈춘다
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v jsonb;
  f text[] := public.quiz_known_formats();
  s text := public.quiz_shuffle_seed('qi_selftest', '2026-08-24 00:00:00+00'::timestamptz);
begin
  if array_length(f, 1) <> 16 then
    raise exception 'quiz_known_formats must list exactly 16 formats (got %)', array_length(f, 1);
  end if;
  -- 되살린 것은 t4 **형태 두 개**지, 2026-08-08 에 폐기한 옛 형태가 아니다.
  if 'pair_pick' = any(f) or 'match_line' = any(f) then
    raise exception 'pair_pick/match_line 은 되살리지 않는다(0125): %', f;
  end if;
  if not ('flip_match' = any(f) and 'link_match' = any(f)) then
    raise exception '0161 formats missing from whitelist: %', f;
  end if;
  -- 0158 이 연 셋도 그대로 있어야 한다(목록을 통째로 다시 쓰다 흘리기 쉬운 자리).
  if not ('order_build' = any(f) and 'scale_pick' = any(f) and 'branch_path' = any(f)) then
    raise exception '0158 formats disappeared from whitelist: %', f;
  end if;

  -- link_match: pairs 가 사라지고 lefts/rights 로 분해된다
  v := public.quiz_strip_payload(s, 'link_match',
       ('{"ask":"a","pairs":[{"left":"L0","right":"R0"},{"left":"L1","right":"R1"},'
        || '{"left":"L2","right":"R2"}],"explain":"e"}')::jsonb);
  if v ?| array['pairs', 'explain'] then raise exception 'strip leak link_match: %', v; end if;
  if not (v ? 'lefts' and v ? 'rights') then raise exception 'strip broke link_match: %', v; end if;
  if jsonb_array_length(v -> 'lefts') <> 3 or jsonb_array_length(v -> 'rights') <> 3 then
    raise exception 'strip broke link_match 개수: %', v;
  end if;
  -- 같은 시드면 같은 순서여야 한다 — 재조회마다 순서가 바뀌면 그 사이 제출된 답을 채점할 수 없다.
  if v <> public.quiz_strip_payload(s, 'link_match',
       ('{"ask":"a","pairs":[{"left":"L0","right":"R0"},{"left":"L1","right":"R1"},'
        || '{"left":"L2","right":"R2"}],"explain":"e"}')::jsonb) then
    raise exception 'strip link_match not deterministic';
  end if;

  -- flip_match: pairs 가 사라지고 카드 2n 장이 생긴다. group 은 **일부러 남는다**(파일 상단 주석).
  v := public.quiz_strip_payload(s, 'flip_match',
       ('{"ask":"a","pairs":[{"left":"L0","right":"R0"},{"left":"L1","right":"R1"},'
        || '{"left":"L2","right":"R2"}],"explain":"e"}')::jsonb);
  if v ?| array['pairs', 'explain'] then raise exception 'strip leak flip_match: %', v; end if;
  if jsonb_array_length(v -> 'cards') <> 6 then raise exception 'strip broke flip_match cards: %', v; end if;
  -- 카드 6장이 서로 다른 글자여야 한다(같은 짝을 두 번 심으면 판이 성립하지 않는다).
  if (select count(distinct c ->> 'text') from jsonb_array_elements(v -> 'cards') c) <> 6 then
    raise exception 'flip_match 카드가 중복됐다: %', v;
  end if;
  -- group 은 0·1·2 가 정확히 두 번씩.
  if exists (
    select 1 from jsonb_array_elements(v -> 'cards') c
    group by c ->> 'group' having count(*) <> 2
  ) then
    raise exception 'flip_match group 이 짝을 이루지 않는다: %', v;
  end if;
  if not (((v -> 'cards') -> 0) ? 'group') then
    raise exception 'flip_match 는 group 이 남아야 게임이 성립한다(의도된 예외): %', v;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑥ 권한 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다(0159 ③ 과 같은 이유)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.quiz_grade_item(text, text, jsonb)',
    'public.quiz_strip_payload(text, text, jsonb)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '내부 전용 함수가 %에게 열려 있다: %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  -- 반대쪽도 확인 — 너무 조여서 정작 definer 래퍼가 못 돌면 퀴즈가 통째로 죽는다.
  if not has_function_privilege(
       (select pg_get_userbyid(proowner) from pg_proc
         where oid = 'public.quiz_grade_item(text, text, jsonb)'::regprocedure),
       'public.quiz_grade_item(text, text, jsonb)', 'EXECUTE') then
    raise exception 'quiz_grade_item 을 소유자마저 실행할 수 없다 — 너무 조였다';
  end if;
end $$;
