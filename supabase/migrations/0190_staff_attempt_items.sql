-- ════════════════════════════════════════════════════════════════════════
-- 0190 — 직원 응시도 **문항별로** 남긴다 (2026-09-11)
-- ════════════════════════════════════════════════════════════════════════
-- ⚠️ 이것은 **원칙을 되돌리는 변경**이다. 기록해 둔다:
--   · 0072 "실패는 저장하지 않는다"(심리적 안전)
--   · 0103(2026-07-29 확정) "개인 오답 저장 금지 — 0072 와 양립하는 유일 경로"
--   · 0112 "문항별로 무엇을 틀렸는지는 저장하지 않는다 … 감시로 읽힐 위험을 피한다"
--   2026-09-11 사용자 결정으로 위를 뒤집는다 — **사장이 개인 오답을 봐야 한다**가 제품 판단이다.
--   따라서 이 표의 성격이 바뀐다: 게스트 전용 이력 → **직원 개인 오답 이력을 포함**한다.
--   개인정보 수집 항목이 늘어나므로 처리방침(법무 v2, 09-11 시행) 대조가 뒤따라야 한다.
--
-- 읽기 권한은 **넓히지 않는다** — SELECT 는 0160 그대로 그 매장 관리 권한만이다.
-- 본인에게도 안 연다(0160 의 기획 Q6 판단 유지): 직원 앱에 정답이 흘러가면 문항이 못 쓰게 된다.

-- ── 1) 누가 풀었나 ───────────────────────────────────────────────────────
-- 게스트 행은 이 값이 null 이다(그쪽은 submission 에 이름·번호가 실린다).
alter table public.quiz_attempt_items
  add column if not exists staff_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_qai_staff
  on public.quiz_attempt_items(unit_id, staff_id, created_at desc)
  where staff_id is not null;

-- ── 2) 직원 응시 기록 RPC ────────────────────────────────────────────────
-- quiz_attempt_items 에는 INSERT 정책이 없다(0160) — definer RPC 가 유일한 입력 경로다.
-- 그래서 직원 경로도 RPC 를 하나 둔다. 겸사겸사 **채점을 서버로 옮긴다**:
-- 지금까지 직원 경로는 클라가 센 correct/total 을 그대로 믿고 적었다. 게스트 경로(0160)는
-- 이미 "클라가 보낸 정오답을 믿지 않는다"이므로, 두 경로의 태도를 같게 맞춘다.
--
-- p_rows = [{"item_id":"qz_…","response":<형태별 응답>,"ord":0}, …]  ← 화면에 나온 순서
-- 반환 = submission_id(한 번의 응시를 묶는 열쇠). 아무것도 못 적었으면 null.
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

  for a in
    select e ->> 'item_id'                          as item_id,
           coalesce(e -> 'response', 'null'::jsonb) as response,
           coalesce((e ->> 'ord')::int, 0)          as ord
      from jsonb_array_elements(v_list) as e
     where jsonb_typeof(e) = 'object'
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

revoke all on function public.quiz_staff_record(jsonb) from public;
grant execute on function public.quiz_staff_record(jsonb) to authenticated;
