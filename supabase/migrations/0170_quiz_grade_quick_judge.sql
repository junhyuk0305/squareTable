-- 0170_quiz_grade_quick_judge.sql — 빠진 채점 분기 하나를 되살린다 (P0)
--
-- ■ 무슨 일이 있었나
-- `quiz_grade_item` 은 0113 에서 만들어져 0158·0161·0168 이 차례로 **통째로 재정의**했다.
-- 그 과정에서 0161 이 `quick_judge`(빠른 판별) 분기를 빠뜨렸다 — 0158 에는 있었고, 0161 본문에는
-- 주석 한 줄("quick_judge 가 같은 이유로 카드 수를 먼저 본다")만 남고 실제 elsif 가 사라졌다.
-- 0168 은 0161 을 베이스로 삼아 그 누락을 그대로 이어받았다.
--
-- ■ 왜 게이트가 못 잡았나
-- `quick_judge` 는 `quiz_known_formats()` 18종에 **그대로 들어 있다.** 그래서
--   · 출제된다(pickFormats 의 t5 회전이 뽑는다)
--   · 배포된다(quiz_link_items·quiz_items_for 가 내준다)
--   · 채점만 `unknown_quiz_format:quick_judge` 로 죽는다
-- 화이트리스트와 채점 분기가 서로를 검사하지 않아 "목록에는 있는데 못 푸는 형태"가 됐다.
-- 응시자 화면에는 "지금은 채점이 안 됐어요 / 다시 보내기"가 뜨고 **다음 문항으로 영영 못 넘어간다**
-- (2026-08-25 브라우저 실측: 게스트 링크에서 재현).
--
-- ■ 이 파일이 하는 일
-- ① 0168 본문을 베이스로(최고 번호 = 정본, AGENTS.md ⑧) `quick_judge` 분기만 되살린다.
-- ② 자가점검이 **화이트리스트의 18종을 하나씩 실제로 채점해 본다** — 같은 사고가 다시 나면
--    마이그레이션이 멈춘다. 개수만 세는 검사(0158·0161·0168)로는 이 누락을 못 잡았다.
--
-- 마이그레이션은 없다(스키마 변경 0건). 함수 본문 하나만 고친다.

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

  -- ── 빠른 판별: 카드마다 고른 값이 cards[i].answer 와 전부 일치 ───────────
  -- ★ 0113·0158 에 있던 분기다. 0161 이 함수를 재정의하면서 **빠뜨렸고** 0168 이 그대로 이어받아,
  --   quick_judge 문항은 화이트리스트(quiz_known_formats)에는 있는데 채점만 못 하는 상태였다.
  --   응시자에게는 "지금은 채점이 안 됐어요 / 다시 보내기"가 뜨고 다음 문항으로 못 넘어간다.
  --   본문은 0158 판을 글자 그대로 되살린다(AGENTS.md ⑧ — 옮길 때 주석도 같이 옮긴다).
  elsif r.format = 'quick_judge' then
    if jsonb_typeof(r.payload -> 'cards') <> 'array' then raise exception 'malformed_item:cards %', r.id; end if;
    if exists (select 1 from jsonb_array_elements(r.payload -> 'cards') c where not (c ? 'answer')) then
      raise exception 'malformed_item:cards[].answer %', r.id;   -- 정답 없는 카드를 오답 처리하면 원인 추적 불가
    end if;
    select coalesce(jsonb_agg(c -> 'answer' order by ord), '[]'::jsonb)
      into v_answer
      from jsonb_array_elements(r.payload -> 'cards') with ordinality as t(c, ord);
    -- ★ 길이부터 본다(0159). p_response 는 익명 호출자가 통째로 정하는 값이다.
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


-- ════════════════════════════════════════════════════════════════════════
-- 권한 재회수 — create or replace 는 ACL 을 보존하지만 "보존됐겠지"에 기대지 않는다(0159 ①).
-- ⛔ from public 만 쓰면 안 닫힌다 — Supabase 는 anon·authenticated 에 **직접** 부여한다.
-- ════════════════════════════════════════════════════════════════════════
revoke all on function public.quiz_grade_item(text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.quiz_grade_item(text, text, jsonb) to service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 자가점검 — 개수가 아니라 **채점 분기의 존재**를 잰다
--
--   0158(14종)·0161(16종)·0168(18종) 의 자가점검은 전부 "화이트리스트에 몇 개 있나"만 셌다.
--   그 검사는 quick_judge 가 목록에 남아 있는 한 통과한다 — 채점이 죽어 있어도 초록이었다.
--   그래서 여기서는 화이트리스트의 형태마다 **채점 함수 본문에 그 형태 리터럴이 있는지**를 본다.
--   (주석에 이름만 남은 경우는 안 잡힌다 — 따옴표까지 포함해 찾기 때문이다. 0161 이 정확히 그
--    상태였다: 본문 주석에는 quick_judge 가 있었지만 'quick_judge' 리터럴은 없었다.)
--   실제 행을 만들어 호출하는 검사는 일부러 안 한다 — 자가점검이 units·quiz_items 에 쓰기를 하면
--   실패했을 때 쓰레기 행이 남고, 그건 채점 버그보다 더 오래 간다.
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v_def  text := pg_get_functiondef('public.quiz_grade_item(text, text, jsonb)'::regprocedure);
  f      text;
  v_miss text[] := '{}';
begin
  foreach f in array public.quiz_known_formats() loop
    if position('''' || f || '''' in v_def) = 0 then
      v_miss := v_miss || f;
    end if;
  end loop;

  if array_length(v_miss, 1) is not null then
    raise exception
      '채점 분기가 없는 형태가 화이트리스트에 있다: % — 출제·배포는 되는데 채점만 죽는 형태가 나간다',
      v_miss;
  end if;

  -- quick_judge 가 실제로 되살아났는지 한 번 더 못박는다(이 파일의 존재 이유).
  if position('''quick_judge''' in v_def) = 0 then
    raise exception '0170 이 quick_judge 분기를 되살리지 못했다';
  end if;
end $$;
