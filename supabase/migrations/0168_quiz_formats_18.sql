-- 0168_quiz_formats_18.sql — 문항 형태 16 → 18종: ⑬숫자 키패드(numeric_entry) · ⑭문단 마킹(mark_paragraph)
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 08-24 UI 카탈로그의 마지막 두 형태다. 기존 형태와 나누는 기준은 **재료의 모양**이지 취향이 아니다:
--   · numeric_entry ↔ fill_count  : 값의 크기. 1~12 는 탭으로 올리고(손이 기억한다), 온도·시간처럼
--     탭으로 못 올리는 값은 텐키로 친다. 보기가 없어 찍기가 안 통한다.
--   · mark_paragraph ↔ mine_tap   : 문장이 이어져 있나. 저쪽은 끊어진 행동 카드가 하나씩 지나가고,
--     이쪽은 "직원이 남긴 인수인계 메시지" 한 덩어리를 읽고 규정과 다른 곳을 짚는다.
--
-- ★ 형태 하나를 추가하면 **9곳**을 함께 고친다. 이 파일은 그중 서버 4곳이다:
--   ④ quiz_known_formats  ⑤ quiz_strip_payload  ⑥ quiz_grade_item  ⑦ 자가점검
--   나머지 5곳(FormatSpec·FORMATS·렌더러·엣지 quizFormats.ts·PayloadForm shapeOf)은 클라 쪽이다.
--   ★ ⑤를 빠뜨리면 **정답이 통째로 샌다.** ④를 빠뜨리면 응시에서 **조용히 빠진다**(fail-closed).
--
-- ★signup-drift ③: quiz_known_formats·quiz_strip_payload·quiz_grade_item 의 최종 정본은 항상 최고
--   번호 마이그레이션이다 — 여기가 정본이다(0107 → 0113 → 0158 → 0159 → 0161 → 여기).
--   0161 본문을 그대로 베이스로 삼고 두 형태의 분기만 더했다. 기존 판정은 1mm도 안 바꿨다.
--
-- ⛔ 0161 의 "16종" 자가점검은 **고치지 않는다.** 이미 적용돼 다시 돌지 않고, 백지 재생 시에는
--    0161 시점의 정답이 여전히 16이다(0158 이 14를 검사하는 것과 같은 이유). 개수 검사는 여기가 잇는다.
--
-- 되돌리려면 quiz_known_formats 를 16종으로 되돌리면 된다 — 두 형태가 fail-closed 로 빠진다.


-- ════════════════════════════════════════════════════════════════════════
-- ④ 형태 화이트리스트 — 여기 없는 형태는 응시에서 조용히 빠진다(fail-closed)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_known_formats()
returns text[] language sql immutable as $$
  select array[
    'mc4', 'order_pick', 'wrong_spot', 'order_build',
    'value_pick', 'fill_count', 'scale_pick', 'numeric_entry',
    'trap_pick', 'mine_tap', 'mark_paragraph',
    'flip_match', 'link_match',
    'case_pick', 'quick_judge', 'branch_path',
    'name_pick', 'chosung'
  ]
$$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑤ 정답 제거 — denylist 다. 새 형태의 정답 키를 여기 안 넣으면 그대로 새어 나간다
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
  -- ★0168: answer_value(numeric_entry) 추가. unit 은 **일부러 남긴다** — "몇 도인가"를 묻는데
  --   단위를 감추면 문제 자체가 성립하지 않는다(정답 키가 아니다).
  v := v - 'answer_index' - 'wrong_index' - 'target' - 'answer_seq' - 'answer_path'
         - 'answer_value' - 'explain';

  if p_format = 'mine_tap' then
    if jsonb_typeof(v -> 'cards') = 'array' then
      select coalesce(jsonb_agg(c - 'is_mine' order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(v -> 'cards') with ordinality as t(c, ord);
      v := jsonb_set(v, '{cards}', v_new);
    end if;

  -- ── 문단 마킹(0168): parts[].is_wrong 만 지운다 ─────────────────────────
  -- ★ tap 은 **일부러 남긴다.** 화면이 탭 가능한 문구에 점선 밑줄을 미리 깔아야 하는데(사용자 확정),
  --   tap 을 감추면 응시자가 어디를 누를 수 있는지 알 수 없어 문항이 성립하지 않는다.
  --   tap 은 "여기가 틀렸다"를 말해 주지 않는다 — 맞게 적힌 문구도 tap=true 다(validate 가 강제한다).
  --   순서는 섞지 않는다. 섞으면 문장이 아니게 된다(link_match 처럼 순열을 쓸 자리가 없다).
  elsif p_format = 'mark_paragraph' then
    if jsonb_typeof(v -> 'parts') = 'array' then
      select coalesce(jsonb_agg(p - 'is_wrong' order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(v -> 'parts') with ordinality as t(p, ord);
      v := jsonb_set(v, '{parts}', v_new);
    end if;

  elsif p_format = 'quick_judge' then
    if jsonb_typeof(v -> 'cards') = 'array' then
      select coalesce(jsonb_agg(c - 'answer' order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(v -> 'cards') with ordinality as t(c, ord);
      v := jsonb_set(v, '{cards}', v_new);
    end if;

  -- ── 뒤집기(0161): pairs 제거 → cards[](결정적 셔플) 로 분해. group 은 **일부러 남긴다** ──
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
-- ⑥ 채점 — numeric_entry · mark_paragraph 신설. 나머지 판정은 0161 그대로다
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

  -- ── 숫자 키패드(0168): 친 숫자가 answer_value 와 정확히 같아야 한다 ──────
  -- 위 세 형태와 같은 모양이다(값 하나 비교). 다른 점은 **보기가 없다**는 것뿐이라 판정은 같다.
  elsif r.format = 'numeric_entry' then
    if not (r.payload ? 'answer_value') then raise exception 'malformed_item:answer_value %', r.id; end if;
    v_answer := r.payload -> 'answer_value';
    v_ok := case when jsonb_typeof(p_response) = 'number'
                 then (p_response #>> '{}')::numeric = (r.payload ->> 'answer_value')::numeric
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

  -- ── 문단 마킹(0168): 탭한 파트 index 집합 == is_wrong 인 index 집합 (부분점수 없음) ──
  -- ★ mine_tap 과 **같은 집합 비교**다(순서가 아니다). 다른 점은 재료가 카드가 아니라 문단 조각이라
  --   tap=false 인 조각(문장을 잇는 글)이 사이사이 섞여 있다는 것뿐인데, index 는 parts 배열 기준
  --   그대로라 판정에는 영향이 없다.
  -- ★ is_wrong 비교를 ::boolean 캐스팅이 아니라 **jsonb 끼리** 한다 — 캐스팅이면 사장이 넣은 값이
  --   boolean 이 아닐 때 채점 자체가 예외로 죽는다(mine_tap 이 안고 있는 위험을 여기서는 안 만든다).
  elsif r.format = 'mark_paragraph' then
    if jsonb_typeof(r.payload -> 'parts') <> 'array' then raise exception 'malformed_item:parts %', r.id; end if;
    select coalesce(array_agg((ord - 1)::int order by ord), '{}'::int[])
      into v_expect
      from jsonb_array_elements(r.payload -> 'parts') with ordinality as t(p, ord)
     where (p -> 'is_wrong') = 'true'::jsonb;
    v_answer := to_jsonb(v_expect);
    -- 길이부터 본다(0159 와 같은 이유) — 조각 수보다 긴 응답은 볼 것도 없이 틀렸다.
    if jsonb_typeof(p_response) <> 'array'
       or jsonb_array_length(p_response) > jsonb_array_length(r.payload -> 'parts')
       or exists (select 1 from jsonb_array_elements(p_response) e where jsonb_typeof(e) <> 'number') then
      v_ok := false;
    else
      select coalesce(array_agg(distinct (e #>> '{}')::numeric::int), '{}'::int[])
        into v_got
        from jsonb_array_elements(p_response) e;
      v_ok := coalesce(v_got = v_expect, false);
    end if;

  -- ── 뒤집어 짝 찾기(0161): 응답 = 짝으로 고정한 순서대로의 **응시용 카드 index**(a1,b1,a2,b2,…) ──
  -- ★ 응시 화면이 받은 cards 는 섞인 것이다 → 여기서도 같은 시드로 strip 을 한 번 더 돌려
  --   **화면이 본 것과 똑같은 배열**을 만든 뒤 그 group 으로 판정한다. 순열을 손으로 되돌리지 않는다.
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
-- ⑦-1 권한 재회수 — create or replace 는 ACL 을 보존하지만 "보존됐겠지"에 기대지 않는다(0159 ①)
-- ════════════════════════════════════════════════════════════════════════
revoke all on function public.quiz_grade_item(text, text, jsonb)    from public, anon, authenticated;
revoke all on function public.quiz_strip_payload(text, text, jsonb) from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⑦-2 자가 점검 — 목록이 벌어지거나 정답이 새면 여기서 멈춘다
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  f       text[] := public.quiz_known_formats();
  v_strip jsonb;
begin
  if array_length(f, 1) <> 18 then
    raise exception 'quiz_known_formats must list exactly 18 formats (got %)', array_length(f, 1);
  end if;
  if not ('numeric_entry' = any(f) and 'mark_paragraph' = any(f)) then
    raise exception '0168 신규 형태가 화이트리스트에 없다: %', f;
  end if;
  -- 앞선 마이그레이션이 넣은 것이 사라지지 않았는지(재정의하며 한 줄 빠뜨리는 사고가 실제로 잦다).
  if not ('order_build' = any(f) and 'scale_pick' = any(f) and 'branch_path' = any(f)
          and 'flip_match' = any(f) and 'link_match' = any(f)) then
    raise exception '이전 형태가 화이트리스트에서 사라졌다: %', f;
  end if;

  -- ★정답이 실제로 지워지는지 여기서 증명한다. 이 검사가 없으면 strip 을 빠뜨려도 아무도 모른다.
  v_strip := public.quiz_strip_payload(
               'seed', 'numeric_entry',
               '{"ask":"우유 스팀 몇 도","answer_value":62,"unit":"도","explain":"x"}'::jsonb);
  if v_strip ? 'answer_value' or v_strip ? 'explain' then
    raise exception 'numeric_entry 정답이 응시 payload 에 남는다: %', v_strip;
  end if;
  if not (v_strip ? 'unit') then
    raise exception 'numeric_entry 의 unit 이 지워졌다 — 단위 없이는 문제가 성립하지 않는다';
  end if;

  -- ★괄호와 ::jsonb 를 빠뜨리지 말 것 — `||` 로 이어붙인 값은 text 라 그대로 넘기면
  --   quiz_strip_payload(unknown, unknown, text) 를 찾다가 42883 으로 죽는다.
  v_strip := public.quiz_strip_payload(
               'seed', 'mark_paragraph',
               ('{"ask":"어디가 규정과 다른가","parts":['
                || '{"text":"포스 정산부터 하고","tap":true,"is_wrong":false},'
                || '{"text":" 그다음 ","tap":false,"is_wrong":false},'
                || '{"text":"바닥부터 쓸었어요","tap":true,"is_wrong":true}'
                || '],"explain":"x"}')::jsonb);
  if v_strip ? 'explain' then
    raise exception 'mark_paragraph 의 explain 이 남는다: %', v_strip;
  end if;
  if exists (select 1 from jsonb_array_elements(v_strip -> 'parts') p where p ? 'is_wrong') then
    raise exception 'mark_paragraph 정답(is_wrong)이 응시 payload 에 남는다: %', v_strip;
  end if;
  -- tap 은 반대로 **남아 있어야** 한다 — 없으면 어디를 누를 수 있는지 알 수 없다.
  if not exists (select 1 from jsonb_array_elements(v_strip -> 'parts') p where (p -> 'tap') = 'true'::jsonb) then
    raise exception 'mark_paragraph 의 tap 이 지워졌다 — 점선 밑줄을 그릴 수 없게 된다';
  end if;
  if jsonb_array_length(v_strip -> 'parts') <> 3 then
    raise exception 'mark_paragraph 의 parts 개수가 바뀌었다(문장이 깨진다): %', v_strip;
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑦-3 권한 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다(0159 ③ 과 같은 이유)
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
    -- 너무 조이면 definer 래퍼가 못 돌아 퀴즈가 통째로 죽는다.
    if not has_function_privilege(
         (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn::regprocedure),
         v_fn, 'EXECUTE') then
      raise exception '%를 소유자마저 실행할 수 없다 — 너무 조였다', v_fn;
    end if;
  end loop;
end $$;
