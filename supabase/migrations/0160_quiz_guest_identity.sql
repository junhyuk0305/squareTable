-- 0160_quiz_guest_identity.sql — 게스트 응시에 전화번호(식별키) + 문항별 응답 상세
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 3단계 재설계(기획/ux/퀴즈_3단계재설계_기획안_2026-08-24.html Q1)는 게스트 응시를
-- **이름 + 전화번호**로 받기로 확정했다. 전화번호가 식별키인 이유는 두 가지다:
--   · 사장이 같은 사람의 재응시를 한 사람으로 묶어 본다(중복 응시 = 최신 결과 + "총 N회").
--   · 그 사람이 나중에 같은 매장에 실제로 합류하면 게스트 응시 이력이 직원 이력으로 이어진다
--     (전화번호 매칭 — profiles.phone_norm 과 같은 normalize_phone 규칙을 쓴다).
-- 그런데 0112 는 guest_name 만 받고, 0113 quiz_link_submit 은 전화번호 인자가 아예 없다.
--
-- 그리고 사장 결과 확인 화면(작업 D)은 "이 사람이 **문항별로 어떻게 풀었는지**"를 보여줘야 하는데
-- 0112 는 **의도적으로** 점수만 남긴다("문항별로 무엇을 틀렸는지는 저장하지 않는다").
-- 그 의도는 **직원 감시를 만들지 않겠다**는 것이고(0103 과 같은 전제), 여기서 그걸 뒤집지 않는다.
--   → 문항별 상세는 **게스트 응시에만** 남긴다. 직원 응시(staff_id)는 0112·0103 그대로다.
--   → 근거: 게스트는 아직 이 매장 사람이 아니고, 사장은 "같이 일할 수 있는 사람인지"를 판단할
--     자료로 이 결과를 본다(소프트게이트). 직원은 이미 뽑은 사람이라 같은 잣대를 대지 않는다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ② 함께 바뀌는 것 — 채점 주체가 클라 → 서버로 넘어온다
-- ══════════════════════════════════════════════════════════════════════════
-- 지금 quiz_link_submit 은 클라가 계산한 {entry_id, total, correct} 를 그대로 받아 적는다.
-- 0112 가 그 한계를 주석으로 인정해 뒀다("점수를 임의 값으로 넣을 수 있다 — 리텐션 신호라 수용").
-- 이번에 응답 원문(p_answers)을 서버로 보내게 되므로, **서버가 quiz_grade_item 으로 다시 채점**하고
-- entry 별 집계까지 서버가 만든다. 같은 코드 경로라 추가 비용이 없고, 클라 집계 코드가 사라진다.
--   ★판정은 여전히 SSOT 한 곳(quiz_grade_item)이다 — 로그인 경로와 같은 함수를 부른다.
--
-- ★signup-drift ③: quiz_link_submit 의 최종 정본은 항상 최고 번호 마이그레이션이다 — 여기가 정본이다.
--   (0113 → 여기. 정의 전수 grep 결과 0113 한 곳뿐이었다.)
--   구 3인자 버전은 drop 한다 — 오버로드가 남으면 전화번호 없이 제출하는 우회로가 그대로 산다
--   (0157 이 phone_in_use 에서 같은 이유로 구버전을 drop 했다).
--
-- ══════════════════════════════════════════════════════════════════════════
-- ③ 새 표의 권한은 "닫고 나서 증명한다"
-- ══════════════════════════════════════════════════════════════════════════
-- Supabase 는 public 스키마 신규 테이블에 anon·authenticated 로 ALL 을 **기본 부여**한다.
-- 0159 에서 배운 것과 같은 함정이다 — 아무것도 안 하면 anon 이 SELECT 그랜트를 갖고 시작한다
-- (RLS 가 0행으로 막긴 하지만, 정답이 통째로 든 payload 스냅샷을 보관하는 표에 2차 방어선이 없다).
--   → revoke ... from public, anon, authenticated 로 전부 회수한 뒤 필요한 것만 다시 준다.
--   → 닫혔다는 것을 §5 자가점검 블록이 증명한다.


-- ════════════════════════════════════════════════════════════════════════
-- 1) quiz_attempts — 전화번호(식별키) + 제출 묶음 id
-- ════════════════════════════════════════════════════════════════════════
-- guest_phone 은 **항상 normalize_phone 결과(숫자만)** 를 담는다. 아래 RPC 가 유일한 입력 경로이고
-- 거기서 정규화한다. 별도 생성컬럼을 두지 않는 이유: 하이픈 있는 원문이 들어올 경로가 없다.
-- (profiles 는 사람이 화면에서 직접 입력한 원문을 보관해야 해서 phone/phone_norm 두 벌이 필요했다.)
alter table public.quiz_attempts add column if not exists guest_phone text;

-- 인증(SMS)은 **선택**이다(기획 결정 §6-B-8). 안 해도 응시·기록은 된다.
-- 이 컬럼은 "이 번호가 본인 것임을 확인했나"를 나중에 판단할 재료다 — 승계(작업 E)에서 이 값을
-- 조건으로 쓸지는 그때 정한다. 지금 안 남기면 그때 소급할 방법이 없어서 여기서 같이 받아 둔다.
alter table public.quiz_attempts add column if not exists guest_phone_verified boolean not null default false;

-- 한 번의 제출이 노하우 여러 건에 걸치면 0112 는 **행을 나눠 적는다**. 그래서 "이 사람이 언제 한 번
-- 푼 것"을 다시 모을 열쇠가 없었다 — 사장 화면은 응시 1회를 카드 1장으로 보여줘야 하므로 필요하다.
-- 문항별 상세(아래 표)도 이 값으로 붙는다.
alter table public.quiz_attempts add column if not exists submission_id text;

-- 전화번호는 손님 행에만 붙는다. 직원 행(staff_id)에 번호가 실리면 0112 의 "둘 중 하나"가 무너지고
-- 직원 개인정보를 이 표가 들고 있게 된다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'quiz_attempts_phone_guest_only' and conrelid = 'public.quiz_attempts'::regclass
  ) then
    alter table public.quiz_attempts add constraint quiz_attempts_phone_guest_only
      check (guest_phone is null or guest_name is not null);
  end if;
end $$;

-- 합류 시 이력 승계(작업 E)와 허브의 "내 게스트 이력" 조회가 전부 이 인덱스를 탄다.
create index if not exists idx_qa_guest_phone on public.quiz_attempts(guest_phone) where guest_phone is not null;
create index if not exists idx_qa_submission  on public.quiz_attempts(unit_id, submission_id) where submission_id is not null;


-- ════════════════════════════════════════════════════════════════════════
-- 2) quiz_attempt_items — 문항별 응답 상세 (★게스트 전용)
-- ════════════════════════════════════════════════════════════════════════
-- ⛔ 직원 응시는 여기 들어오지 않는다. 유일한 입력 경로가 quiz_link_submit(토큰 경로)이다.
--    로그인 응시(grade_quiz)는 손대지 않았다 — 0103·0112 의 "개인 오답 이력 없음"이 그대로다.
--
-- ★ payload 를 그 시점 그대로 스냅샷한다(정답 포함). 사장은 문항을 나중에 고치거나 지울 수 있는데
--   (deleteQuizItem 경로가 있다), 그때 quiz_items 를 조인해 보여주면 **응시자가 실제로 본 것과 다른
--   문항**이 사장 화면에 뜬다. 스냅샷이면 그 사고가 원천적으로 없고, 조인도 필요 없다.
--   정답이 든 값이라 읽기 권한을 관리 권한으로만 연다(아래 RLS).
create table if not exists public.quiz_attempt_items (
  id            text primary key default ('qai_' || replace(gen_random_uuid()::text, '-', '')),
  unit_id       text not null references public.units(id) on delete cascade,
  submission_id text not null,
  -- quiz_items 로의 FK 를 **일부러 걸지 않는다**. 걸면 사장이 문항을 지우는 순간 응시 이력이 같이
  -- 사라진다 — 이력은 "그때 이렇게 풀었다"는 사실이라 문항의 수명을 따라가면 안 된다.
  item_id       text not null,
  ord           int  not null,
  format        text not null,
  payload       jsonb not null,
  response      jsonb,
  correct       boolean not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_qai_sub  on public.quiz_attempt_items(submission_id, ord);
create index if not exists idx_qai_unit on public.quiz_attempt_items(unit_id, created_at desc);

alter table public.quiz_attempt_items enable row level security;

-- RLS: SELECT = 그 매장 관리 권한만. 본인(응시자)에게도 안 연다 — 게스트는 세션이 없고,
--      기획 Q6 이 "단기 직원 본인은 점수만, 문항 내용·정답은 비공개"로 확정했다.
--      INSERT·UPDATE·DELETE 정책 없음 = definer RPC 만이 유일한 입력 경로다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists qai_select on public.quiz_attempt_items;
    create policy qai_select on public.quiz_attempt_items
      for select using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- ★ Supabase 기본 부여를 되돌린다(0159 와 같은 함정 — 아무것도 안 하면 anon 도 ALL 을 갖는다).
revoke all on table public.quiz_attempt_items from public, anon, authenticated;
-- 사장·매니저가 PostgREST 로 읽는다. 행 범위는 위 정책이 좁힌다.
grant select on table public.quiz_attempt_items to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 3) quiz_link_submit 재정의 — 응답 원문을 받아 서버가 채점하고 서버가 집계한다
-- ════════════════════════════════════════════════════════════════════════
-- p_answers = [{"item_id":"qi_...","response": <문항 형태별 응답 jsonb>}, ...]  ← 화면에 나온 순서
-- 반환 = quiz_attempts 에 적힌 행 수(= 점수가 귀속된 노하우 건수). 0 이면 아무것도 안 적혔다.
drop function if exists public.quiz_link_submit(text, text, jsonb);

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
    insert into public.quiz_attempts
      (unit_id, entry_id, guest_name, guest_phone, guest_phone_verified, submission_id, total, correct)
    select l.unit_id, s.entry_id, v_name, v_phone, coalesce(p_phone_verified, false), v_sub, s.total, s.correct
      from scored s
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end $$;

-- 로그인 없이 도는 경로 — 필요한 두 롤에만 연다.
revoke all on function public.quiz_link_submit(text, text, text, boolean, jsonb) from public;
grant execute on function public.quiz_link_submit(text, text, text, boolean, jsonb) to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 4) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다 (0159 §3 과 같은 이유)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare v_priv text;
begin
  -- anon 은 이 표에 아무 권한도 없어야 한다. 정답이 든 payload 스냅샷을 담는 표다.
  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.quiz_attempt_items', v_priv) then
      raise exception 'quiz_attempt_items 가 anon 에게 % 로 열려 있다', v_priv;
    end if;
  end loop;

  -- authenticated 는 읽기만. 쓰기가 열려 있으면 직원이 자기 상세를 지어낼 수 있다.
  foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.quiz_attempt_items', v_priv) then
      raise exception 'quiz_attempt_items 에 authenticated 의 % 권한이 남아 있다', v_priv;
    end if;
  end loop;

  -- 반대쪽도 확인 — 너무 조이면 사장 결과 화면이 통째로 빈다.
  if not has_table_privilege('authenticated', 'public.quiz_attempt_items', 'SELECT') then
    raise exception 'quiz_attempt_items 를 authenticated 가 읽지 못한다 — 사장 화면이 빈다';
  end if;

  -- 구 3인자 quiz_link_submit 이 남아 있으면 전화번호 없이 제출하는 우회로가 산다.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'quiz_link_submit'
       and pg_get_function_identity_arguments(p.oid) = 'text, text, jsonb'
  ) then
    raise exception '구 quiz_link_submit(text, text, jsonb) 가 아직 살아 있다';
  end if;

  -- 새 버전은 게스트(anon)가 부를 수 있어야 한다 — 로그인 없이 도는 유일한 경로다.
  if not has_function_privilege('anon',
       'public.quiz_link_submit(text, text, text, boolean, jsonb)', 'EXECUTE') then
    raise exception 'quiz_link_submit 을 anon 이 부를 수 없다 — 게스트 응시가 통째로 죽는다';
  end if;
end $$;
