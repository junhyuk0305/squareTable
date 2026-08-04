-- 0113_quiz_links.sql — 외부 공유 링크(단기 직원용) (3단계 3-2)
--
-- 정본: 기획/퀴즈_노하우축_이동_기획_2026-08-04.md §4.2
--   링크를 열면 **이름만 적고 바로 푼다.** 로그인·가입 없음.
--
-- ★ 이것이 로그인 없이 도는 유일한 경로다. 그래서 기존 인증 경로(auth_unit_id() 기반 RLS)를
--   1mm도 열지 않는다 — 접근은 아래 definer RPC 4개 + 토큰 검증뿐이고, 테이블 자체의 RLS 는
--   anon 에게 아무 정책도 주지 않는다(= 0행).
-- ★ 정답 유출 방어(0107)는 그대로다. 토큰으로 와도 quiz_strip_payload 를 통과한 정답 제거본만
--   내려가고 채점은 서버가 한다. 게다가 그 링크의 코스에 담긴 노하우 문항만 다룬다 —
--   토큰 하나로 매장 전체 문항을 훑을 수 없다.
-- ⚠️ 링크를 받은 사람은 매장 노하우를 보게 된다(문항 안에 절차·수치가 들어간다).
--   그래서 만료가 필수(not null)이고 회수(revoked_at)를 반드시 제공한다. 화면도 이 사실을 알린다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) 링크
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.quiz_links (
  id         text primary key,
  unit_id    text not null references public.units(id) on delete cascade,
  course_id  text not null references public.training_courses(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,     -- 만료 없는 링크는 만들 수 없다(영구 공개 금지)
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- 토큰이 곧 유일한 열쇠라 길이를 스키마에 못박는다. 클라는 UUID(32자)를 쓰지만, 나중에 다른
  -- 경로가 짧은 값을 넣으면 그 순간 추측이 가능해진다 — "그러지 않기로 했다"를 코드가 아니라 제약으로 남긴다.
  constraint quiz_links_token_len check (length(token) >= 20)
);
create index if not exists idx_ql_unit   on public.quiz_links(unit_id);
create index if not exists idx_ql_course on public.quiz_links(course_id);

alter table public.quiz_links enable row level security;

-- RLS: 4종 전부 관리 권한(0093)만. 직원도 못 읽는다 — 링크는 사장이 밖으로 내보내는 열쇠다.
--      anon 은 정책이 없어 0행이다(아래 RPC 로만 접근).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists ql_select on public.quiz_links;
    create policy ql_select on public.quiz_links
      for select using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists ql_insert on public.quiz_links;
    create policy ql_insert on public.quiz_links
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and (created_by is null or created_by = (select auth.uid()))
        -- 코스 소유까지 검사 — 남의 매장 코스 id 로 링크를 만들면 그 링크가 뒤에서 코스 조인을 탄다.
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = unit_id)
      );

    drop policy if exists ql_update on public.quiz_links;
    create policy ql_update on public.quiz_links
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = unit_id)
      );

    drop policy if exists ql_delete on public.quiz_links;
    create policy ql_delete on public.quiz_links
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) 토큰 검증 — 살아 있는 링크 한 행 (내부 전용)
-- ════════════════════════════════════════════════════════════════════════
-- 만료·회수 판정을 여기 한 곳에만 둔다. 아래 RPC 4개가 전부 이걸 부른다 — 한 군데만 고치면
-- 네 경로가 같이 닫힌다(만료된 링크가 어느 한 경로에서만 열려 있는 사고를 막는다).
create or replace function public.quiz_link_resolve(p_token text)
returns public.quiz_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.quiz_links l
   where l.token = p_token
     and l.revoked_at is null
     and l.expires_at > now()
   limit 1
$$;
-- 클라에 열지 않는다 — 열면 링크 행(다른 매장 토큰 포함)이 그대로 나간다.
revoke all on function public.quiz_link_resolve(text) from public;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 채점 본체 분리 — grade_quiz(0107)의 몸통을 함수 하나로 내린다
-- ════════════════════════════════════════════════════════════════════════
-- 왜: 토큰 경로에도 채점이 필요한데, 같은 판정을 두 벌 쓰면 형태를 추가할 때 한쪽만 고쳐져
--     "로그인하면 맞고 링크로는 틀리는" 문항이 생긴다(AGENTS.md ②: 판정은 SSOT 한 곳).
--     차이는 **매장을 어디서 얻느냐**뿐이라, 그것만 인자로 뺀다.
--
-- ⚠️⚠️ 형태(format)를 추가하면 네 곳을 함께 고친다:
--       ① quiz_known_formats()  ② quiz_strip_payload()  ③ **이 함수**(0107 grade_quiz 에서 이사)
--       ④ 0107 끝의 자가점검 블록. 하나라도 빠지면 정답이 새거나 조용한 오답이 된다.
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

-- 클라에 열지 않는다 — 매장을 인자로 받으므로 직접 호출하면 남의 매장 문항을 채점해 볼 수 있다
-- (오답이면 정답이 돌아온다 = 유출). 아래 두 래퍼만 노출한다.
revoke all on function public.quiz_grade_item(text, text, jsonb) from public;

-- grade_quiz(0107) 재정의 — 몸통이 위로 이사했고 인증·매장 판정만 남는다. 동작·반환은 그대로.
-- ★signup-drift ③: 이 함수의 최종 정본은 항상 최고 번호 마이그레이션이다 — 여기가 정본이다.
create or replace function public.grade_quiz(p_item_id text, p_response jsonb)
returns table (correct boolean, explain text, answer jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  return query select * from public.quiz_grade_item(p_item_id, v_unit, p_response);
end $$;

grant execute on function public.grade_quiz(text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 손님 경로 RPC 3종 — 토큰이 유일한 열쇠
-- ════════════════════════════════════════════════════════════════════════

-- 4-1) 링크 열기 — 어느 매장의 어떤 코스인지 + 낼 문항이 있는지.
-- 만료·회수·오타 토큰을 구분해서 알려주지 않는다(ok=false 하나) — 토큰 존재 여부를 떠보는 걸 막는다.
create or replace function public.quiz_link_open(p_token text)
returns table (ok boolean, store_name text, course_name text, item_count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.quiz_links;
  v_n int;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then
    return query select false, null::text, null::text, 0;
    return;
  end if;
  select count(*)::int into v_n
    from public.quiz_items q
   where q.unit_id = l.unit_id
     and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and exists (
       select 1 from public.course_entries ce
        where ce.course_id = l.course_id and ce.entry_id = any(q.entry_ids)
     );
  return query
    select true, u.store_name, c.name, v_n
      from public.units u, public.training_courses c
     where u.id = l.unit_id and c.id = l.course_id;
end $$;

-- 4-2) 응시용 문항 — 그 링크의 코스에 담긴 노하우 문항만, 정답 제거본으로.
-- 순서는 토큰마다 다르고 재조회해도 같다(md5(id||token)) — 새로고침에 순서가 흔들리면 채점을 못 한다.
create or replace function public.quiz_link_items(p_token text, p_limit int default 5)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then return; end if;   -- 만료된 링크는 문항을 한 건도 내주지 않는다
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = l.unit_id
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- fail-closed(0107 §3)
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(q.entry_ids)
       )
     order by md5(q.id || p_token)
     limit least(greatest(coalesce(p_limit, 5), 1), 20);
end $$;

-- 4-3) 채점 — 몸통은 위 quiz_grade_item 하나(로그인 경로와 같은 판정).
-- ★그 링크의 코스에 담긴 문항인지 먼저 확인한다. 없으면 토큰 하나로 매장 전체 문항을 찍어보며
--  오답 응답으로 정답을 뽑아낼 수 있다.
create or replace function public.quiz_link_grade(p_token text, p_item_id text, p_response jsonb)
returns table (correct boolean, explain text, answer jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then raise exception 'link_unavailable'; end if;
  if not exists (
    select 1 from public.quiz_items q
     join public.course_entries ce
       on ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(q.entry_ids)
    where q.id = p_item_id and q.unit_id = l.unit_id and q.status = 'active'
  ) then
    raise exception 'item_not_found';
  end if;
  return query select * from public.quiz_grade_item(p_item_id, l.unit_id, p_response);
end $$;

-- 4-4) 결과 기록 — quiz_attempts 에 guest_name 으로. 노하우별로 나눠 적는다(0112 행 단위).
-- p_rows = [{"entry_id":"pb_...","total":3,"correct":2}, ...]
-- ⚠️ 손님 응시는 knowhow_quiz_stats(0103, 매장 오답 통계)에 넣지 않는다. 그 통계는 "노하우 글이
--    헷갈리게 적혔나"를 재는 신호인데, 그 매장 노하우를 본 적 없는 사람의 오답이 섞이면 사장에게
--    "글을 고치세요"라고 잘못 말하게 된다.
create or replace function public.quiz_link_submit(p_token text, p_guest_name text, p_rows jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  l      public.quiz_links;
  v_name text := btrim(coalesce(p_guest_name, ''));
  v_n    int;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then raise exception 'link_unavailable'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  v_name := left(v_name, 20);
  -- 한 번에 넣을 수 있는 행 수를 막는다. 토큰을 가진 사람이 배열에 수만 건을 실어 보내면
  -- 매장 응시 기록이 통째로 오염된다(링크는 카톡방에 도는 물건이라 현실적인 시나리오다).
  -- ⚠️ 남는 위험: 호출 자체를 반복하는 것은 못 막는다. 그래서 만료가 필수이고 회수가 항상 곁에 있다.
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'bad_rows'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 50 then raise exception 'too_many_rows'; end if;

  with ins as (
    insert into public.quiz_attempts (unit_id, entry_id, guest_name, total, correct)
    select l.unit_id, r.entry_id, v_name, r.total, r.correct
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(entry_id text, total int, correct int)
     where r.entry_id is not null
       and r.total > 0 and r.correct >= 0 and r.correct <= r.total
       -- 그 링크의 코스에 담긴 노하우만 — 임의 entry_id 로 남의 노하우에 점수를 심을 수 없다.
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = r.entry_id
       )
    returning 1
  )
  select count(*)::int into v_n from ins;
  return v_n;
end $$;

-- 로그인 없이 도는 경로 — anon 에게만 필요한 만큼 연다. authenticated 도 같은 링크를 열 수 있다
-- (사장이 자기 링크를 확인하는 경우).
grant execute on function public.quiz_link_open(text)                to anon, authenticated;
grant execute on function public.quiz_link_items(text, int)          to anon, authenticated;
grant execute on function public.quiz_link_grade(text, text, jsonb)  to anon, authenticated;
grant execute on function public.quiz_link_submit(text, text, jsonb) to anon, authenticated;
