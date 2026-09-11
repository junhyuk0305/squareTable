-- ════════════════════════════════════════════════════════════════════════
-- 0189 — 링크 응시 결과를 **어느 퀴즈 것인지** 되짚을 수 있게 한다 (2026-09-11)
-- ════════════════════════════════════════════════════════════════════════
-- 문제: 사장이 같은 퀴즈를 사람이 바뀔 때마다 다시 내보내는데(= 한 퀴즈 · 배포 여러 번),
--       정작 "이 퀴즈를 누가 풀었나"를 화면에 못 그렸다. `quiz_attempts` 는 0112 이래
--       `entry_id`(노하우)만 들고 있어서 코스로 역추적할 방법이 없었기 때문이다.
--       노하우로 되짚는 것은 **틀린다** — 한 노하우가 여러 코스에 담기면 같은 응시가
--       여러 퀴즈에 겹쳐 나온다. 지어내지 않는다(0160 §2 와 같은 태도).
--
-- 그래서 귀속을 **쓰는 시점에** 기록한다. 링크는 `quiz_links.course_id` 를 이미 알고 있으므로
-- 새로 계산할 것이 없다 — 적기만 하면 된다.
--
-- ★기존 행은 null 로 남는다. 지난 응시가 어느 퀴즈였는지는 **지금 와서 알 수 없다** —
--   추측해서 채우지 않는다. 화면은 null 을 "퀴즈를 알 수 없는 지난 응시"로 두고 세지 않는다.
-- ★직원(로그인) 응시 경로는 건드리지 않는다. 그쪽은 0103·0112 귀속 그대로다.

-- ── 1) 컬럼 ──────────────────────────────────────────────────────────────
-- on delete set null: 퀴즈를 지워도 **응시 기록은 남는다**(0113 의 '회수는 기록을 안 지운다'와 같은 원칙).
alter table public.quiz_attempts
  add column if not exists course_id text references public.training_courses(id) on delete set null;

-- 사장 화면이 "이 퀴즈의 응시"를 최근순으로 읽는다 — 그 축 그대로 인덱스.
create index if not exists idx_qa_course
  on public.quiz_attempts(unit_id, course_id, taken_at desc)
  where course_id is not null;

-- ── 2) quiz_link_submit 재정의 ───────────────────────────────────────────
-- 정본은 0160 이었다(AGENTS.md ⑧: 최고 번호를 베이스로 삼는다). 본문·주석을 그대로 옮기고
-- **quiz_attempts INSERT 한 곳에만** course_id 를 더했다. 시그니처는 그대로라 drop 이 필요 없다.
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

  -- 전화번호는 **식별키라 필수**다(기획 Q1). 인증(SMS)이 선택인 것과 다른 이야기 —
  -- 번호가 없으면 재응시를 한 사람으로 묶지도, 합류 시 이력을 이어 붙이지도 못한다.
  if v_phone is null or v_phone = '' then raise exception 'phone_required'; end if;
  if v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception 'bad_phone'; end if;

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
    select l.unit_id, s.entry_id, l.course_id, v_name, v_phone, coalesce(p_phone_verified, false), v_sub, s.total, s.correct
      from scored s
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end $$;

-- 로그인 없이 도는 경로 — 필요한 두 롤에만 연다.
revoke all on function public.quiz_link_submit(text, text, text, boolean, jsonb) from public;
grant execute on function public.quiz_link_submit(text, text, text, boolean, jsonb) to anon, authenticated;
