-- 0107_quiz_items.sql — 훈련 문항 영속화 + 서버 채점 (훈련 v2)
--
-- 지금까지 문항은 응시 때마다 엣지가 즉석 생성 → 클라 채점 → 폐기였다(AI 캡을 응시마다 태우고,
-- 같은 사람이 같은 문항을 다시 못 만난다). 문항을 저장하면 캡 소모가 생성 1회로 끝나지만
-- **정답이 DB 에 남는다** — 직원이 테이블을 직접 읽으면 답을 본다.
-- 그래서 이 파일은 한 세트로 움직인다: ① 직원 SELECT 정책을 아예 주지 않고(관리자만)
-- ② 응시용 조회는 definer RPC quiz_items_for 가 정답 키를 제거해서 돌려주고
-- ③ 채점은 definer RPC grade_quiz 가 서버에서 한다. 클라 채점은 이 구조에서 곧 정답 유출이다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) 테이블
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.quiz_items (
  id          text primary key,
  unit_id     text not null references public.units(id) on delete cascade,
  entry_ids   text[] not null,          -- 근거 노하우 1건 이상. 배열이라 FK 불가 → 조회 시 필터
  kind        text not null,            -- t0..t6 (지식 유형)
  format      text not null,            -- 출제 형태. check 없음 = 형태 추가에 마이그레이션 불필요
  payload     jsonb not null,           -- 형태별 본문 + 정답(★관리자만 원본을 본다)
  source      text not null default 'ai' check (source in ('ai', 'owner')),
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_quiz_items_unit on public.quiz_items(unit_id, status);
create index if not exists idx_quiz_items_entries on public.quiz_items using gin (entry_ids);

alter table public.quiz_items enable row level security;

-- RLS: ★SELECT 를 직원에게 주지 않는다(payload 안에 정답이 있다). 관리자(0093)만 4종 전부.
--      직원의 응시 경로는 아래 definer RPC 두 개뿐 — 테이블 직접 조회는 0행이다.
--      WITH CHECK 는 INSERT/UPDATE 양쪽에 명시(0079 교훈: USING 만 두면 남의 매장으로 위조 가능).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists qi_select on public.quiz_items;
    create policy qi_select on public.quiz_items
      for select using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists qi_insert on public.quiz_items;
    create policy qi_insert on public.quiz_items
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists qi_update on public.quiz_items;
    create policy qi_update on public.quiz_items
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists qi_delete on public.quiz_items;
    create policy qi_delete on public.quiz_items
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- realtime 미등록(의도): 문항은 응시 시작 시점 1회 조회. 실시간 반영 대상이 아니다.

-- ════════════════════════════════════════════════════════════════════════
-- 2) 결정적 셔플 — match_line 의 오른쪽 보기 순서
-- ════════════════════════════════════════════════════════════════════════
-- pairs[i].left ↔ pairs[i].right 가 정답이므로 오른쪽을 원본 순서로 내려보내면 "i번째끼리 잇기"가
-- 그대로 정답이다 → 반드시 섞어야 한다. 단 random() 은 금지: 재조회(새로고침·재시도)마다 순서가
-- 바뀌면 그 사이 제출된 답을 채점할 수 없다. 그래서 시드 기반 결정적 순열을 쓴다.
--
-- ★시드 = 문항 id + created_at. id 만으로는 안 된다 — md5(id) 규칙은 공개 알고리즘이고 id 는
--   응시자에게 내려가므로, 직원이 순열을 그대로 재현해 정답을 계산할 수 있다.
--   created_at 은 quiz_items_for 가 반환하지 않는다(마이크로초 단위라 추측 불가) → 실질 비밀 시드.
--   렌더링은 세션 TimeZone/DateStyle 에 흔들리지 않게 UTC + 고정 포맷으로 고정한다.
--
-- 반환: perm[k] = 섞인 자리 (k-1) 에 놓인 원본 pairs index. 1-based 배열, 값은 0-based index.
create or replace function public.quiz_shuffle_seed(p_id text, p_created_at timestamptz)
returns text language sql immutable as $$
  select coalesce(p_id, '') || ':' || coalesce(to_char(p_created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), '')
$$;

create or replace function public.quiz_right_perm(p_seed text, p_n int)
returns int[] language sql immutable as $$
  select coalesce(array_agg(i order by md5(p_seed || '#' || i::text)), '{}'::int[])
    from generate_series(0, greatest(coalesce(p_n, 0), 0) - 1) i
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 정답 제거 — 응시용 payload 로 깎는다
-- ════════════════════════════════════════════════════════════════════════
-- ★이 목록은 클라 레지스트리 src/lib/quiz/formats/index.ts 의 FormatSpec.stripKeys 와
--   글자 그대로 같아야 한다. 한쪽만 바뀌면 정답이 새거나(누락) 응시가 깨진다(과다 제거).
--   양쪽 다 이 주석으로 서로를 가리킨다.
--
--   공통 제거          : answer_index, wrong_index, target, explain
--   mine_tap           : cards[].is_mine 제거
--   quick_judge        : cards[].answer 제거
--   match_line         : pairs 제거 → lefts[](원본 순서) + rights[](결정적 셔플) 로 분해
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
  v := v - 'answer_index' - 'wrong_index' - 'target' - 'explain';

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

-- ★★ 정답 제거는 denylist 다 — "아는 키만" 지운다. 그래서 strip 규칙을 모르는 형태를 그대로
--    내보내면 그 형태의 정답 키가 통째로 새어 나간다. 형태 추가는 "파일 하나 + index 한 줄"로
--    끝나도록 설계돼 있어(src/lib/quiz/formats), 여기를 같이 고치는 걸 잊기 쉽다.
--    → 아는 형태만 화이트리스트로 서빙한다. 모르는 형태는 응시에서 조용히 빠진다(fail-closed).
--    클라는 문항 0건이면 기존 AI 즉석 생성으로 폴백하므로 훈련이 멈추지는 않는다.
--    ⚠️ 형태를 추가하면 ① 이 목록 ② quiz_strip_payload ③ grade_quiz ④ 아래 자가점검 을 함께 고친다.
create or replace function public.quiz_known_formats()
returns text[] language sql immutable as $$
  select array[
    'mc4', 'order_pick', 'wrong_spot', 'value_pick', 'fill_count',
    'trap_pick', 'mine_tap', 'pair_pick', 'match_line', 'case_pick',
    'quick_judge', 'name_pick', 'chosung'
  ]
$$;

-- ★셔플 헬퍼·strip 은 클라에 열지 않는다. 열면 응시자가 같은 시드로 순열을 재현해
--   match_line 정답을 계산할 수 있다. definer RPC 는 함수 소유자로 실행되므로 영향 없다.
--   (Postgres 는 함수 생성 시 EXECUTE 를 PUBLIC 에 기본 부여한다 → 명시적 revoke 가 필요하다.)
revoke all on function public.quiz_shuffle_seed(text, timestamptz) from public;
revoke all on function public.quiz_right_perm(text, int) from public;
revoke all on function public.quiz_strip_payload(text, text, jsonb) from public;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 응시용 조회 — quiz_items_for
-- ════════════════════════════════════════════════════════════════════════
-- 호출자의 활성 매장(auth_unit_id) · status='active' · 주어진 노하우를 근거로 하는 문항만.
-- 순서는 md5(문항id + 응시자uid) — 사람마다 다른 순서, 같은 사람에겐 안정적(새로고침해도 동일).
create or replace function public.quiz_items_for(p_entry_ids text[], p_limit int default 3)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit text := public.auth_unit_id();
  v_uid  text := coalesce(auth.uid()::text, '');
begin
  if v_unit is null or p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = v_unit
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- ★fail-closed: 위 주석 참조
       and q.entry_ids && p_entry_ids
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;

grant execute on function public.quiz_items_for(text[], int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 5) 채점 — grade_quiz
-- ════════════════════════════════════════════════════════════════════════
-- 활성 매장의 active 문항만 채점. answer 는 **틀렸을 때만** 채워서 돌려준다(맞으면 null).
--
-- p_response 모양 (형태별. src/lib/quiz/types.ts QuizResponse 와 일치):
--   number                 — 선택지형 / wrong_spot / fill_count
--   number[]               — mine_tap(탭한 index들) / quick_judge(카드별 선택)
--   {"왼쪽idx":"오른쪽idx"} — match_line
--
-- ★★ C(응시 UI) 담당이 반드시 읽을 것 — match_line 응답 좌표계
--    quiz_items_for 는 pairs 를 lefts[] + rights[] 로 분해하고 **rights 를 섞어서** 내려준다.
--    클라는 원본 pairs index 를 알 수 없고(알면 그게 곧 정답이다) 알아서도 안 된다.
--    따라서 클라는 **화면에 보이는 rights 배열의 index(=섞인 자리)** 를 그대로 돌려준다:
--        { "0": 2, "1": 0, "2": 1 }   // 왼쪽 0번을 화면상 오른쪽 2번에 이었다
--    서버가 같은 시드로 순열을 복원해 원본 index 로 되돌린 뒤 "왼쪽 i ↔ 원본 오른쪽 i" 항등을 검사한다.
--    (설계 스펙 초안은 "클라가 원본 index 를 돌려준다"였으나, 원본 index 를 클라에 알려주는 순간
--     정답을 통째로 넘기는 것이 되어 성립하지 않는다. 좌표계를 섞인 자리로 확정한다.)
--
-- 알 수 없는 format 은 correct=false 가 아니라 예외다 — 조용한 오답이 가장 나쁘다(원인 추적 불가).
-- 정답 키가 없는 malformed 문항도 같은 이유로 예외.
create or replace function public.grade_quiz(p_item_id text, p_response jsonb)
returns table (correct boolean, explain text, answer jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit    text := public.auth_unit_id();
  r         public.quiz_items%rowtype;
  v_ok      boolean;
  v_answer  jsonb;
  v_expect  int[];
  v_got     int[];
  v_n       int;
  v_perm    int[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;

  select * into r
    from public.quiz_items q
   where q.id = p_item_id and q.unit_id = v_unit and q.status = 'active';
  if not found then raise exception 'item_not_found'; end if;

  -- ── 선택지 하나 고르는 형태 ─────────────────────────────────────────────
  -- ⚠️ SQL 의 and 는 단축평가를 보장하지 않는다 → 타입 검사 뒤에 캐스팅을 두면 안 되고
  --    case 로 분기해야 한다(문자열 응답이 오면 캐스팅 예외로 채점 자체가 죽는다).
  --    비교는 ::numeric — 모델이 1 대신 1.0 을 뱉어도 같은 값으로 본다(::int 는 1.5 에서 터진다).
  if r.format in ('mc4', 'order_pick', 'value_pick', 'trap_pick', 'pair_pick', 'case_pick', 'name_pick', 'chosung') then
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

  -- ── 줄 잇기: 섞인 자리 → 원본 index 복원 후 항등 검사 (위 좌표계 주석 참조) ──
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

grant execute on function public.grade_quiz(text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 6) 정답 유출 자가 점검 — 적용 시점에 실행되는 검사(실패하면 push 가 멈춘다)
-- ════════════════════════════════════════════════════════════════════════
-- quiz_items_for 가 돌려주는 payload = quiz_strip_payload 의 결과다. 그 결과에 정답 키가
-- 하나라도 남아 있으면 여기서 예외가 나 마이그레이션이 실패한다(무음 유출 방지).
do $$
declare
  v jsonb;
  s text := public.quiz_shuffle_seed('qi_selftest', '2026-08-03 00:00:00+00'::timestamptz);
begin
  -- 선택지형
  v := public.quiz_strip_payload(s, 'mc4', '{"ask":"a","choices":["x","y"],"answer_index":1,"explain":"e"}'::jsonb);
  if v ?| array['answer_index', 'explain'] then raise exception 'strip leak mc4: %', v; end if;

  -- wrong_spot / fill_count
  v := public.quiz_strip_payload(s, 'wrong_spot', '{"ask":"a","sequence":["1","2","3"],"wrong_index":2,"explain":"e"}'::jsonb);
  if v ?| array['wrong_index', 'explain'] then raise exception 'strip leak wrong_spot: %', v; end if;
  v := public.quiz_strip_payload(s, 'fill_count', '{"ask":"a","target":3,"unit":"펌프","explain":"e"}'::jsonb);
  if v ?| array['target', 'explain'] then raise exception 'strip leak fill_count: %', v; end if;

  -- mine_tap: 카드에서 is_mine 이 사라져야 한다
  v := public.quiz_strip_payload(s, 'mine_tap',
       '{"ask":"a","cards":[{"text":"c1","is_mine":true},{"text":"c2","is_mine":false}],"explain":"e"}'::jsonb);
  if v ? 'explain' then raise exception 'strip leak mine_tap explain: %', v; end if;
  if exists (select 1 from jsonb_array_elements(v -> 'cards') c where c ? 'is_mine') then
    raise exception 'strip leak mine_tap is_mine: %', v;
  end if;
  if jsonb_array_length(v -> 'cards') <> 2 then raise exception 'strip broke mine_tap cards: %', v; end if;

  -- quick_judge: 카드에서 answer 가 사라져야 한다
  v := public.quiz_strip_payload(s, 'quick_judge',
       '{"ask":"a","labels":["ok","no"],"cards":[{"text":"c1","answer":0},{"text":"c2","answer":1}],"seconds":5,"explain":"e"}'::jsonb);
  if exists (select 1 from jsonb_array_elements(v -> 'cards') c where c ? 'answer') then
    raise exception 'strip leak quick_judge answer: %', v;
  end if;

  -- match_line: pairs 가 사라지고 lefts/rights 로 분해되며, rights 는 원본 순서와 무관해야 한다
  v := public.quiz_strip_payload(s, 'match_line',
       '{"ask":"a","pairs":[{"left":"L0","right":"R0"},{"left":"L1","right":"R1"},{"left":"L2","right":"R2"}],"explain":"e"}'::jsonb);
  if v ?| array['pairs', 'explain'] then raise exception 'strip leak match_line: %', v; end if;
  if not (v ? 'lefts' and v ? 'rights') then raise exception 'strip broke match_line: %', v; end if;
  if jsonb_array_length(v -> 'rights') <> 3 then raise exception 'strip broke match_line rights: %', v; end if;
  -- 같은 시드면 결과가 항상 같아야 한다(재조회 안정성 = 채점 가능성의 전제)
  if v <> public.quiz_strip_payload(s, 'match_line',
       '{"ask":"a","pairs":[{"left":"L0","right":"R0"},{"left":"L1","right":"R1"},{"left":"L2","right":"R2"}],"explain":"e"}'::jsonb) then
    raise exception 'strip match_line not deterministic';
  end if;
end $$;
