-- 0202_quiz_link_submit_cap.sql — 게스트 제출 상한을 출제 상한과 맞춘다
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────────────────
-- 0188(2026-09-08)이 게스트 출제 상한(5개 표본)을 없애 **코스 문항 전부**를 내보내게 했는데,
-- 제출 쪽 `quiz_link_submit` 은 0113 시절의 `> 50 → too_many_rows` 를 그대로 들고 있었다.
-- 결과: 문항 51개짜리 퀴즈는 51개가 다 출제되고, 손님이 전부 푼 뒤 제출하면 통째로 거부된다.
-- 화면은 "결과를 보내지 못했어요"만 말하고 **다시 풀 길이 없다** — 그 퀴즈는 끝낼 수가 없다.
-- (2026-09-14 조용한 오류 QA 에서 발견. 두 상한이 어긋난 채 09-08부터 살아 있었다.)
--
-- ── 무엇을 바꾸나 ───────────────────────────────────────────────────────────────────────
-- 본문은 **0195 를 파일에서 그대로 복사**하고 상한 한 줄만 500 으로 바꿨다
-- (전화번호 선택 0195 · 코스 귀속 0189 · 스냅샷 0160 은 한 줄도 안 바뀐다).
-- ⛔ 출제 쪽(0188 `quiz_link_items`)에 상한을 되살리지 않는다 — 개수 판단은 사장이 한다.
--
-- ⚠️ 적용 후: qa:quiz-link · qa:training green 확인.

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
  for a in
    select e ->> 'item_id'                        as item_id,
           coalesce(e -> 'response', 'null'::jsonb) as response,
           (ord - 1)::int                         as ord
      from jsonb_array_elements(v_list) with ordinality as t(e, ord)
     where jsonb_typeof(e) = 'object'
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

-- 적용 후 확인: 문항 51개 코스의 링크로 51개 답을 제출 → 성공(적힌 행 수 > 0).
--   501개를 보내면 too_many_rows 로 여전히 막히는지.
