-- ════════════════════════════════════════════════════════════════════════
-- 0195 — 링크 응시의 전화번호를 **선택**으로 (2026-09-13)
-- ════════════════════════════════════════════════════════════════════════
-- 외부 사람(지원자·단기)은 로그인 없이 링크로 푼다. 이름은 사장이 결과를 볼 때 꼭 필요하지만,
-- 전화번호는 "같은 사람의 재응시 묶기·합류 시 이력 잇기"라는 **부가 가치**를 위한 것이라
-- 최소수집 원칙상 강제하지 않는다. 적으면 그대로 쓰고, 안 적으면 그 두 가지가 안 될 뿐이다.
--
-- 정본은 0189 였다(AGENTS.md ⑧: 정의 전수 = 0113·0160·0189, 최고 번호를 베이스로). 본문·주석을 그대로
-- 옮기고 **전화번호 검사 두 줄과 INSERT 의 verified 한 칸**만 바꿨다. 시그니처는 그대로라 drop 이 필요 없다.
-- 컬럼은 0160 부터 nullable 이었고 check(guest_phone is null or guest_name is not null)도 그대로 만족한다.
-- 화면(/q/[token])과 게이트(qa:training ⑩-15b)는 같은 작업에서 바꿨다.

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
  if jsonb_typeof(v_list) <> 'array' then raise exception 'bad_answers'; end if;
  if jsonb_array_length(v_list) > 50 then raise exception 'too_many_rows'; end if;

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

-- 로그인 없이 도는 경로 — 필요한 두 롤에만 연다.
revoke all on function public.quiz_link_submit(text, text, text, boolean, jsonb) from public;
grant execute on function public.quiz_link_submit(text, text, text, boolean, jsonb) to anon, authenticated;
