-- 0159_quiz_internal_grants.sql — 내부 전용 퀴즈 함수를 **실제로** 닫는다 + 순서배열 채점 길이 가드
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①) — `revoke ... from public` 이 이 프로젝트에서는 안 닫혔다
-- ══════════════════════════════════════════════════════════════════════════
-- 0107·0113 은 내부 전용 함수를 `revoke all on function ... from public` 으로 닫아 뒀고,
-- 주석으로 그 이유까지 적어 뒀다:
--   quiz_grade_item — "클라에 열지 않는다 — 매장을 인자로 받으므로 직접 호출하면 남의 매장 문항을
--                      채점해 볼 수 있다(오답이면 정답이 돌아온다 = 유출)."
--   quiz_shuffle_seed / quiz_right_perm / quiz_strip_payload
--                    — "열면 응시자가 같은 시드로 순열을 재현해 정답을 계산할 수 있다."
--
-- 그런데 2026-08-24 실측에서 **anon 이 셋 다 그냥 호출됐다**:
--   anon → quiz_grade_item    → item_not_found  (= 권한은 통과하고 본문까지 실행됨)
--   anon → quiz_strip_payload → 정상 반환
--   anon → quiz_right_perm    → 정상 반환
--
-- 이유: Supabase 는 `anon`·`authenticated` 에 EXECUTE 를 **직접** 부여한다.
--       `revoke ... from public` 은 PUBLIC 의 몫만 회수할 뿐 **직접 부여분을 건드리지 못한다.**
--       그래서 지금까지의 revoke 는 전부 무해한 no-op 이었다(0158 이 재발행한 것도 마찬가지).
--
-- ★ 이건 0158 이 만든 구멍이 아니다 — 0158 이 손대지도 않은 quiz_right_perm 도 똑같이 열려 있었다.
--   0107·0113 시점부터의 구조적 문제이고, 여기서 처음으로 실제로 닫는다.
--
-- ── 지금 당장 뚫리는 상태였나 ──────────────────────────────────────────────
-- quiz_grade_item 을 악용하려면 quiz_items.id 와 unit_id 를 **둘 다** 알아야 한다(둘 다 고엔트로피
-- 랜덤 id). 게스트는 링크로 문항 id 는 받지만 unit_id 는 받지 않는다. 즉 즉시 악용 가능한 상태는
-- 아니었고, **의도했던 2차 방어선이 없는 상태**였다. 그래도 설계가 명시적으로 닫으라고 한 문이다.
--
-- ── 앱이 깨지지 않는 근거 ──────────────────────────────────────────────────
-- 이 함수들을 호출하는 래퍼가 **전부 security definer** 다(실측 확인):
--   grade_quiz · quiz_link_grade · quiz_link_items · quiz_link_open · quiz_items_for
-- definer 함수는 **소유자 권한으로 실행**되므로 호출자(anon/authenticated)의 EXECUTE 를 회수해도
-- 안쪽 호출은 그대로 된다. 클라·엣지·QA 어디에도 이 4개를 직접 부르는 코드는 없다(grep 0건).
--
-- ══════════════════════════════════════════════════════════════════════════
-- ② 함께 고치는 것 — 순서배열 채점의 길이 가드
-- ══════════════════════════════════════════════════════════════════════════
-- 0158 이 신설한 order_build·branch_path 채점 분기는 응답 배열을 **먼저 통째로 집계한 뒤** 비교했다.
-- p_response 는 익명 호출자가 정하는 값이라 20만 칸을 보내도 전부 집계한다. quick_judge 는 같은
-- 이유로 카드 수를 먼저 보고 짧게 끊는다 — 그 순서를 맞춘다. 판정 결과는 바뀌지 않는다.
--
-- ★signup-drift ③: quiz_grade_item 의 최종 정본은 항상 최고 번호 마이그레이션이다 — 여기가 정본이다.
--   (0113 → 0158 → 여기. 본문을 옮기며 설계 주석도 함께 옮겼다.)


-- ════════════════════════════════════════════════════════════════════════
-- ① 내부 전용 함수 — anon·authenticated 까지 회수
-- ════════════════════════════════════════════════════════════════════════
-- ⛔ service_role 과 소유자(postgres)는 건드리지 않는다 — definer 실행과 운영 도구가 이걸 쓴다.
revoke all on function public.quiz_grade_item(text, text, jsonb)   from public, anon, authenticated;
revoke all on function public.quiz_strip_payload(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.quiz_right_perm(text, int)            from public, anon, authenticated;
revoke all on function public.quiz_shuffle_seed(text, timestamptz)  from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ② 채점 재정의 — 순서배열 분기에 길이 가드(판정은 안 바뀐다)
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

-- 새로 만든 정본에도 같은 회수를 다시 건다. create or replace 는 ACL 을 보존하지만, 이 함수는
-- 새면 곧 정답 유출이라 "보존됐겠지"에 기대지 않는다.
revoke all on function public.quiz_grade_item(text, text, jsonb) from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ③ 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다
-- ════════════════════════════════════════════════════════════════════════
-- ★ 이 블록이 0107·0113 에 없어서 revoke 가 5개월간 no-op 인 걸 아무도 몰랐다.
--   앞으로 이 함수들의 권한이 다시 열리면 마이그레이션이 여기서 멈춘다.
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.quiz_grade_item(text, text, jsonb)',
    'public.quiz_strip_payload(text, text, jsonb)',
    'public.quiz_right_perm(text, int)',
    'public.quiz_shuffle_seed(text, timestamptz)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '내부 전용 함수가 %에게 열려 있다: %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  -- 반대쪽도 확인 — 너무 조여서 정작 래퍼가 못 돌면 퀴즈가 통째로 죽는다.
  -- definer 함수의 소유자는 여전히 실행할 수 있어야 한다.
  if not has_function_privilege(
       (select pg_get_userbyid(proowner) from pg_proc
         where oid = 'public.quiz_grade_item(text, text, jsonb)'::regprocedure),
       'public.quiz_grade_item(text, text, jsonb)', 'EXECUTE') then
    raise exception 'quiz_grade_item 을 소유자마저 실행할 수 없다 — 너무 조였다';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- ④ 길이 가드 회귀 확인 — 판정이 바뀌지 않았는지
-- ════════════════════════════════════════════════════════════════════════
-- 실제 채점은 문항 행이 있어야 해서 여기서 못 돈다(라이브 검증은 qa:training ⑦B-7~15 가 한다).
-- 여기서는 형태 목록이 여전히 14종인지만 지킨다 — 0158 의 전제가 깨지지 않았음을 확인.
do $$
declare v text[] := public.quiz_known_formats();
begin
  if array_length(v, 1) <> 14 then
    raise exception 'quiz_known_formats must still list 14 formats (got %)', array_length(v, 1);
  end if;
  if not ('order_build' = any(v) and 'branch_path' = any(v)) then
    raise exception '순서배열 형태가 화이트리스트에서 사라졌다: %', v;
  end if;
end $$;
