-- 0203_quiz_attempt_dedup.sql — 응시 제출에서 **문항 하나당 한 번만** 받는다
--
-- ── 무엇을 고치나(2026-09-14 보안 QA 실측) ─────────────────────────────────────────────
-- 게스트 링크로 같은 item_id 를 200번 보냈더니 `quiz_attempt_items` 에 **200행이 그대로 적혔다.**
-- 코스에 문항이 1개뿐인데 사장 화면 점수가 `0/200` 으로 찍혔다.
-- 제출 함수 두 개가 배열을 그대로 순회하고, 테이블에 (submission_id, item_id) 유일 제약도 없다.
--
-- 이게 왜 단순한 남용이 아니라 **데이터 무결성** 문제인가:
--   ① 응시자가 자기 점수를 지어낼 수 있다 — 맞힌 문항만 200번 보내면 "200문제 중 200개".
--   ② 그 행들이 0199 `quiz_course_stats` 의 sum(correct)/sum(total) 로 들어가 **코스 정답률**을
--      오염시킨다. 09-13 에 새로 붙인 정답률 카드가 그 숫자를 그대로 보여준다.
--   ③ 쓰기 증폭: 링크는 카톡방에 도는 물건이고 제출 횟수 제한이 없다. 요청 1건에 최대 500행.
--      (0202 가 상한을 50→500 으로 올리면서 요청당 비용도 10배가 됐다 — 그 전제가 이 수정이다.)
--
-- ── 어떻게 ──────────────────────────────────────────────────────────────────────────────
-- 두 함수의 순회 쿼리를 `distinct on (item_id)` 로 바꿔 **처음 낸 답만** 남긴다
-- (먼저 낸 것이 그 사람의 답이다 — 나중 것으로 덮으면 "고쳐 보내기"가 되어 규칙이 바뀐다).
-- 유일 인덱스를 걸지 않는 이유: 루프 중간에 제약 위반이 나면 **제출 전체가 예외로 죽는다** —
-- 손님은 다시 풀 방법이 없다. 걸러내는 것이 막는 것보다 안전하다.
--
-- 본문은 각각 0202(게스트)·0190(직원)에서 **파일 그대로 복사**했고 순회 쿼리만 바꿨다.
-- 상한(게스트 500 · 직원 50)·채점 함수·스냅샷·코스 귀속은 한 줄도 안 바뀐다.
--
-- ⚠️ 적용 후: qa:quiz-link · qa:quiz-grading · qa:training green + 중복 제출 실측 재확인.

create or replace function public.quiz_link_submit(
  p_token          text,
  p_guest_name     text,
  p_guest_phone    text,
  p_phone_verified boolean,
  p_answers        jsonb
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  l       public.quiz_links;
  v_name  text := btrim(coalesce(p_guest_name, ''));
  v_phone text := public.normalize_phone(p_guest_phone);
  v_sub   text := 'qs_' || replace(gen_random_uuid()::text, '-', '');
  v_list  jsonb := coalesce(p_answers, '[]'::jsonb);
  v_n     int;
  a       record;
  q       public.quiz_items%rowtype;
  g       record;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then raise exception 'link_unavailable'; end if;

  if v_name = '' then raise exception 'name_required'; end if;
  v_name := left(v_name, 20);

  -- ★0195: 전화번호는 **선택**이다. 0160 은 식별키라 필수로 뒀지만, 로그인 없는 외부 사람에게
  --   번호까지 요구하는 것은 개인정보 최소수집 원칙과 맞지 않았다(2026-09-13 사용자 결정).
  --   안 적으면 null 로 남는다 — 그 응시는 재응시 묶기·합류 시 이력 잇기가 안 된다(화면이 그렇게 말한다).
  --   적었으면 휴대폰 형식이어야 한다(잘못 적은 번호를 식별키로 쓰면 남의 이력에 붙는다).
  if v_phone = '' then v_phone := null; end if;
  if v_phone is not null and v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception 'bad_phone'; end if;

  -- 배열 크기를 먼저 끊는다(0113 과 같은 이유 — 링크는 카톡방에 도는 물건이다).
  -- ★0202: 상한 50 → 500. 0188 이 **출제** 상한을 없앤 뒤로 앞뒤가 안 맞았다 — 문항 51개짜리
  --   퀴즈는 51개가 전부 출제되는데 제출은 too_many_rows 로 통째로 거부됐고, 손님은 다 풀고
  --   나서야 "보내지 못했어요"를 봤다. 출제와 제출의 상한이 어긋나면 그 퀴즈는 존재만 하고
  --   끝낼 수가 없다. 값 500 은 copy_knowhow_between 의 남용 하드상한과 같은 값이다
  --   (한 요청이 무한정 커지지 않게 하는 목적이지, 문항 수를 판단하는 값이 아니다 — 개수 판단은
  --   퀴즈를 만드는 사장이 한다는 0188 결정 그대로).
  if jsonb_typeof(v_list) <> 'array' then raise exception 'bad_answers'; end if;
  if jsonb_array_length(v_list) > 500 then raise exception 'too_many_rows'; end if;

  -- ── 문항별: 소유 검사 → 서버 채점 → 스냅샷 기록 ──────────────────────────
  -- ★0203: **문항 하나당 한 번만** 받는다. 예전엔 배열을 그대로 순회해, 같은 item_id 를 200번
  --   보내면 200행이 적혔다(문항 1개짜리 퀴즈의 점수가 '200문제 중 200개'가 된다 — 실측 확인).
  --   그 행들이 0199 quiz_course_stats 의 sum(correct)/sum(total) 에도 들어가 코스 정답률을 오염시킨다.
  --   같은 문항이 여러 번 오면 **처음 것**을 남긴다(먼저 낸 답이 그 사람의 답이다).
  for a in
    with raw as (
      select e ->> 'item_id'                        as item_id,
             coalesce(e -> 'response', 'null'::jsonb) as response,
             (ord - 1)::int                         as ord
        from jsonb_array_elements(v_list) with ordinality as t(e, ord)
       where jsonb_typeof(e) = 'object'
    ),
    once as (
      select distinct on (item_id) item_id, response, ord
        from raw
       where item_id is not null
       order by item_id, ord
    )
    select item_id, response, ord from once order by ord
  loop
    continue when a.item_id is null;

    -- ★그 링크의 코스에 담긴 문항인지 확인한다. 이 검사가 없으면 임의 문항 id 로 남의 노하우에
    --   점수를 심을 수 있다(0113 quiz_link_grade 와 같은 검사).
    --   조용히 버린다(예외 아님) — 문항 하나가 그 사이 지워졌다고 응시자의 나머지 답까지 잃으면 안 된다.
    select * into q
      from public.quiz_items qi
     where qi.id = a.item_id
       and qi.unit_id = l.unit_id
       and qi.status = 'active'
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(qi.entry_ids)
       );
    continue when not found;

    -- 로그인 경로와 **같은 판정 함수**다. 클라가 보낸 정오답을 믿지 않는다.
    -- 문항이 깨져 있으면 여기서 예외가 난다 — 조용한 오답으로 뭉개지 않는다(0107 §3 과 같은 태도).
    select * into g from public.quiz_grade_item(a.item_id, l.unit_id, a.response);

    insert into public.quiz_attempt_items
      (unit_id, submission_id, item_id, ord, format, payload, response, correct)
    values
      (l.unit_id, v_sub, q.id, a.ord, q.format, q.payload, a.response, coalesce(g.correct, false));
  end loop;

  -- ── 노하우별 집계 → quiz_attempts (0112 행 단위 그대로) ─────────────────
  -- 문항 하나가 노하우 여러 건에 걸리면 각 노하우에 1건씩 센다 — 0103 매장 통계와 같은 귀속 방식.
  with agg as (
    select unnest(qi.entry_ids) as entry_id, ai.correct
      from public.quiz_attempt_items ai
      join public.quiz_items qi on qi.id = ai.item_id
     where ai.submission_id = v_sub
  ),
  scored as (
    select agg.entry_id,
           count(*)::int                              as total,
           count(*) filter (where agg.correct)::int   as correct
      from agg
     where exists (
       select 1 from public.course_entries ce
        where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = agg.entry_id
     )
     group by agg.entry_id
  ),
  ins as (
    -- ★0189 에서 course_id 한 칸만 늘었다 — 값은 링크가 이미 들고 있는 것(l.course_id)이다.
    insert into public.quiz_attempts
      (unit_id, entry_id, course_id, guest_name, guest_phone, guest_phone_verified, submission_id, total, correct)
    -- 번호가 없으면 '확인된 번호'도 없다 — 클라 값이 뭐든 false.
    select l.unit_id, s.entry_id, l.course_id, v_name, v_phone, (v_phone is not null and coalesce(p_phone_verified, false)), v_sub, s.total, s.correct
      from scored s
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end $$;

grant execute on function public.quiz_link_submit(text, text, text, boolean, jsonb) to anon, authenticated;

-- ── 직원(로그인) 경로 — 같은 규칙 ──────────────────────────────────────────────────────
create or replace function public.quiz_staff_record(p_rows jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_sub   text := 'qs_' || replace(gen_random_uuid()::text, '-', '');
  v_list  jsonb := coalesce(p_rows, '[]'::jsonb);
  v_n     int;
  a       record;
  q       public.quiz_items%rowtype;
  g       record;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;

  -- 배열 크기를 먼저 끊는다(0113·0160 과 같은 이유).
  if jsonb_typeof(v_list) <> 'array' then raise exception 'bad_answers'; end if;
  if jsonb_array_length(v_list) > 50 then raise exception 'too_many_rows'; end if;

  -- ★0203: 게스트 경로와 **같은 규칙** — 문항 하나당 한 번만. 직원도 같은 답을 반복해 보내
  --   자기 점수를 부풀릴 수 있었다(둘 다 같은 테이블에 적고, 같은 집계에 들어간다).
  for a in
    with raw as (
      select e ->> 'item_id'                          as item_id,
             coalesce(e -> 'response', 'null'::jsonb) as response,
             coalesce((e ->> 'ord')::int, 0)          as ord,
             ordinality                               as seq
        from jsonb_array_elements(v_list) with ordinality as t(e, ordinality)
       where jsonb_typeof(e) = 'object'
    ),
    once as (
      select distinct on (item_id) item_id, response, ord, seq
        from raw
       where item_id is not null
       order by item_id, seq
    )
    select item_id, response, ord from once order by seq
  loop
    continue when a.item_id is null;

    -- ★내 매장의 살아 있는 문항인지 본다. 없으면 조용히 버린다(예외 아님) — 문항 하나가
    --   그 사이 지워졌다고 나머지 답까지 잃으면 안 된다(0160 과 같은 태도).
    select * into q
      from public.quiz_items qi
     where qi.id = a.item_id and qi.unit_id = v_unit and qi.status = 'active';
    continue when not found;

    -- 게스트 경로와 **같은 판정 함수**다. 클라가 보낸 정오답을 믿지 않는다.
    select * into g from public.quiz_grade_item(a.item_id, v_unit, a.response);

    insert into public.quiz_attempt_items
      (unit_id, submission_id, staff_id, item_id, ord, format, payload, response, correct)
    values
      (v_unit, v_sub, v_uid, q.id, a.ord, q.format, q.payload, a.response, coalesce(g.correct, false));
  end loop;

  -- ── 노하우별 집계 → quiz_attempts (0112 행 단위 그대로) ─────────────────
  -- 문항 하나가 노하우 여러 건에 걸리면 각 노하우에 1건씩 센다 — 0103·0160 과 같은 귀속 방식.
  with agg as (
    select unnest(qi.entry_ids) as entry_id, ai.correct
      from public.quiz_attempt_items ai
      join public.quiz_items qi on qi.id = ai.item_id
     where ai.submission_id = v_sub
  ),
  scored as (
    select agg.entry_id,
           count(*)::int                            as total,
           count(*) filter (where agg.correct)::int as correct
      from agg
     group by agg.entry_id
  ),
  ins as (
    insert into public.quiz_attempts
      (unit_id, entry_id, staff_id, submission_id, total, correct)
    select v_unit, s.entry_id, v_uid, v_sub, s.total, s.correct
      from scored s
    returning 1
  )
  select count(*)::int into v_n from ins;

  if v_n = 0 then return null; end if;
  return v_sub;
end $$;

grant execute on function public.quiz_staff_record(jsonb) to authenticated;

-- 적용 후 확인: 문항 1개짜리 코스에 같은 item_id 200개를 제출 → quiz_attempt_items 1행,
--   quiz_attempts.total = 1. 서로 다른 문항 N개는 그대로 N행.
