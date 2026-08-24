-- 0165_guest_quiz_carryover.sql — 매장 없는 회원의 게스트 응시 이력 조회 + 합류 시 직원 이력 승계
--
-- ⚠️ 선행 의존: **0163_quiz_guest_review.sql** — 아래 조회 RPC 가 `quiz_attempts.cleared_at`
--    (사장이 "정리하기" 한 표시)을 참조한다. 0163 을 먼저 적용하지 않으면 이 파일은 실패한다.
--    §4 자가점검이 그 컬럼의 존재를 먼저 확인해 "왜 실패했는지"를 말해 준다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 0160 으로 게스트가 외부 링크(/q/[token])로 푼 결과가 전화번호와 함께 남기 시작했다.
-- 그런데 그 사람이 계정을 만들어도 **매장이 0곳이면 자기가 푼 결과를 볼 방법이 아예 없다**:
--   · quiz_attempts 의 SELECT 정책(0112)은 `unit_id = auth_unit_id() and (staff_id = auth.uid() or …)` 인데
--     매장 없는 회원은 auth_unit_id() 가 null 이라 **한 행도 못 읽는다**.
--   · 게스트 행은 staff_id 가 null 이라 두 번째 조건도 영영 참이 되지 않는다.
-- 허브의 "매장 없음" 화면이 지금 말할 수 있는 것은 "합류를 기다리세요"뿐이고, 그 사이 이 사람이
-- 우리 앱에서 실제로 한 유일한 행동(퀴즈를 풀었다)이 화면 어디에도 없다.
--   → 본인 전용 definer RPC 하나(§2)로 **점수와 취약영역까지만** 돌려준다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ② 전화번호를 클라가 넘기게 하지 않는다 — 인자 0개 RPC
-- ══════════════════════════════════════════════════════════════════════════
-- 번호를 인자로 받으면 아무 번호나 넣어 **남의 응시 이력을 조회**할 수 있다(게스트 행은 로그인
-- 세션과 묶여 있지 않아 소유를 증명할 다른 열쇠가 없다). 그래서 이 함수는 인자를 하나도 받지 않고
-- auth.uid() → profiles.phone_norm(0022 생성컬럼, normalize_phone 규칙 = 0160 이 guest_phone 에
-- 쓰는 규칙과 동일)을 **서버가 직접 읽는다**. §4 자가점검이 "인자 0개"를 불변식으로 박아 둔다.
--
-- ★남는 한계(의도적 수용): 게스트 응시의 SMS 인증은 **선택**이다(0160 §guest_phone_verified).
--   그래서 남의 번호를 적어 푼 응시가 그 번호 주인의 이력에 섞여 보일 수 있다. 인증된 것만
--   보여주면 대부분의 행이 사라져 기능 자체가 죽으므로 지금은 조건으로 쓰지 않는다.
--   새는 것은 "그 사람이 어느 매장에서 몇 점 받았나"까지고, 문항·정답·개인정보는 §2 가 안 준다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ③ 합류 승계 — staff_id 를 채우되 0112 의 불변식은 건드리지 않는다
-- ══════════════════════════════════════════════════════════════════════════
-- 0112 의 `quiz_attempts_who check ((staff_id is null) <> (guest_name is null))` 은
-- "누가 풀었는지는 반드시 하나로 정해진다"는 불변식이다. 승계하면서 guest_name 을 그대로 두면
-- 이 제약이 합류 자체를 죽인다. 세 선택지 중:
--   (a) 제약을 느슨하게(둘 다 허용) → 0112 의 불변식이 영구히 약해진다. 채택 안 함.
--   (b) guest_name 을 그냥 비운다 → "누가 풀었나"의 원래 표시(그 사람이 직접 적은 이름)가 사라진다.
--   (c) ★채택: 원래 이름을 `former_guest_name` 으로 **옮기고** guest_name 을 비운다.
--       제약은 1mm 도 안 바뀌고, 원래 표시는 남고, 이 컬럼이 곧 "게스트로 풀었다가 합류한 행"의
--       판별자가 된다(직원이 로그인해서 푼 행은 이 값이 null 이다).
--
-- guest_phone 은 **스냅샷하지 않고 비운다.** 0160 이 "전화번호는 손님 행에만 붙는다 — 직원 행에
-- 실리면 직원 개인정보를 이 표가 들고 있게 된다"고 못박았고, 승계 후에는 staff_id 가 그 역할을
-- 대신한다. (0160 의 `quiz_attempts_phone_guest_only` 도 guest_name 이 비면 번호를 못 남기게 한다.)
--
-- ★부수효과(의도한 것): 승계된 행은 사장의 게스트 목록(0163 화면)에서 빠진다. 승계는 전화번호
--   단위라 그 사람의 **그 매장 행 전부가 한꺼번에** 넘어가므로 반쯤 남는 카드가 생기지 않는다.
--   행을 지우는 것이 아니라 주인이 바뀌는 것이고, 문항별 상세(quiz_attempt_items)는 그대로 남는다.
--
-- ★join_by_invite 는 손대지 않는다. 0067(정본, 전수 grep 확인: 0002·0005·0009·0029·0031·0032·
--   0038·0065·0067 중 최고 번호)의 본문은 pending_unit_id 만 세운다 — 그 시점엔 아직 합류가
--   아니라 **신청**이라 이어 붙일 이력이 없다. 실제 소속이 확정되는 곳은 approve_member 하나뿐이다.
--   손대지 않으므로 여기서 재확정할 이유도 없다(signup-drift ③ 은 "손대면"의 규칙이다).


-- ════════════════════════════════════════════════════════════════════════
-- 1) former_guest_name — 승계된 행이 들고 가는 "그때 적은 이름"
-- ════════════════════════════════════════════════════════════════════════
alter table public.quiz_attempts add column if not exists former_guest_name text;

-- 본인 이력 조회는 (guest_phone) 인덱스(0160 idx_qa_guest_phone)를 그대로 탄다 — 새 인덱스 없음.


-- ════════════════════════════════════════════════════════════════════════
-- 2) my_guest_quiz_history() — 본인 게스트 응시 이력 (인자 0개)
-- ════════════════════════════════════════════════════════════════════════
-- 돌려주는 것: 매장 이름 · submission_id · 점수 · 시각 · 취약영역(틀린 노하우 제목).
-- ⛔ 문항 내용·정답·응답 원문·다른 사람 정보는 돌려주지 않는다. 문항별 상세(quiz_attempt_items)는
--    0160 이 **관리 권한에게만** 연 것이고(기획 Q6: 본인은 점수만), definer 라고 그 경계를 넘지 않는다
--    — 아래는 그 표에서 **개수만** 세고 payload·response 는 읽지도 않는다.
--
-- ★응시 1회 = 결과 1건. 0112 는 행 단위가 (응시 1회, 노하우 1건)이라 한 번의 제출이 여러 행으로
--   나뉜다(0160 §1) → submission_id 로 묶는다. 화면이 다시 묶지 않는다.
-- ★점수는 **문항 수**로 말한다. quiz_attempts 의 합은 노하우별 귀속이라 한 문항이 노하우 두 건에
--   걸리면 2로 세어진다 → 문항별 상세가 있으면 그쪽 개수로 덮는다(사장 화면과 같은 잣대, db.ts
--   fetchGuestQuizSubmissions ③ 과 동일). 상세가 없는 옛 행은 노하우 합을 그대로 쓴다.
create or replace function public.my_guest_quiz_history()
returns table(
  unit_id       text,
  store_name    text,
  submission_id text,
  total         int,
  correct       int,
  taken_at      timestamptz,
  weak_titles   text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    -- 탈퇴 계정은 제외. phone 이 비어 있으면(가입 직후·보류) 아무것도 안 돌려준다.
    select p.phone_norm as ph
      from public.profiles p
     where p.id = (select auth.uid())
       and p.deleted_at is null
       and p.phone_norm is not null
       and p.phone_norm <> ''
  ),
  mine as (
    select a.unit_id as at_unit, a.submission_id as at_sub, a.entry_id as at_entry,
           a.total as at_total, a.correct as at_correct, a.taken_at as at_taken
      from public.quiz_attempts a, me
     where a.guest_phone = me.ph
       -- 게스트 행만. 승계된 행(staff_id 채워짐)은 이미 그 매장 직원 이력이라 여기 안 나온다.
       and a.staff_id is null
       -- submission_id 가 없는 0160 이전 행은 묶을 열쇠가 없어 결과 1건으로 세울 수 없다.
       and a.submission_id is not null
       -- 사장이 "정리하기" 한 것은 뺀다(0163 cleared_at).
       and a.cleared_at is null
  ),
  items as (
    -- 개수만 센다 — payload·response 는 읽지 않는다(위 ⛔).
    select ai.submission_id as it_sub,
           count(*)::int                             as it_total,
           count(*) filter (where ai.correct)::int   as it_correct
      from public.quiz_attempt_items ai
     where ai.submission_id in (select at_sub from mine)
     group by ai.submission_id
  ),
  agg as (
    select m.at_unit,
           m.at_sub,
           sum(m.at_total)::int   as sum_total,
           sum(m.at_correct)::int as sum_correct,
           min(m.at_taken)        as first_taken,
           -- 취약영역 = 다 못 맞힌 노하우의 제목. ★pe 조인에 unit_id 를 넣는다 — definer 라 RLS 를
           --   우회하므로, 행에 남의 매장 노하우 id 가 어떻게든 들어와 있으면 그 제목이 샌다
           --   (0111 §5 my_training_history 와 같은 2중 방어).
           array_remove(
             array_agg(distinct case when m.at_correct < m.at_total then pe.title end),
             null
           ) as weak
      from mine m
      left join public.playbook_entries pe
        on pe.id = m.at_entry and pe.unit_id = m.at_unit
     group by m.at_unit, m.at_sub
  )
  select agg.at_unit,
         u.store_name,
         agg.at_sub,
         coalesce(i.it_total,   agg.sum_total),
         coalesce(i.it_correct, agg.sum_correct),
         agg.first_taken,
         agg.weak
    from agg
    join public.units u on u.id = agg.at_unit and u.deleted_at is null
    left join items i on i.it_sub = agg.at_sub
   order by agg.first_taken desc
   limit 50
$$;

-- ⛔ from public 만 쓰면 안 닫힌다(0159 실측 — Supabase 는 anon·authenticated 에 **직접** 부여한다).
revoke all on function public.my_guest_quiz_history() from public, anon, authenticated;
grant execute on function public.my_guest_quiz_history() to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 3) approve_member 재정의 — 소속이 확정되는 순간 게스트 이력을 승계한다
-- ════════════════════════════════════════════════════════════════════════
-- ★signup-drift ③: 정의 전수 grep 결과 approve_member 는 0032·0038·0056·0062·0067·0093·0115·0117 에
--   걸쳐 재정의돼 있고 **최고 번호 0117 이 정본**이다. 아래는 0117 본문을 그대로 베이스로 하고
--   §승계 블록만 덧붙인 것이다(0115 가 0093 대신 0062 를 베이스로 삼아 qa:roles 를 11개 깨뜨린 선례).
--   좌석 캡·승인권(owner/manager)·unit_members 기록은 0117 그대로다 — 한 줄도 바꾸지 않았다.
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_plan  text;
  v_staff int;
  v_phone text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role in ('owner', 'manager')
  ) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  -- 신청(pending) 검증 + 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 승인은 현재 활성 유지).
  update public.profiles
     set unit_id         = coalesce(unit_id, v_unit),
         active_unit_id  = coalesce(active_unit_id, v_unit),
         pending_unit_id = null,
         role            = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, v_unit, 'junior')
    on conflict (user_id, unit_id) do nothing;

  -- ── 0165: 게스트 응시 이력 승계 ───────────────────────────────────────────
  -- 이 매장에서 **같은 전화번호로 링크를 풀었던 행**의 주인을 이 직원으로 바꾼다(§③).
  -- ★합류가 본 목적이고 승계는 부가다 — 여기서 무슨 일이 나도 합류를 되돌리지 않는다.
  --   (제약 위반·컬럼 부재·데이터 이상 전부 흡수. 승계는 다음 합류 때 다시 시도되지 않으므로
  --    실패하면 그 이력은 게스트 행으로 남는다 — 화면이 비는 것이 합류가 죽는 것보다 낫다.)
  begin
    select p.phone_norm into v_phone from public.profiles p where p.id = p_uid;
    if coalesce(v_phone, '') <> '' then
      update public.quiz_attempts a
         set staff_id          = p_uid,
             former_guest_name = a.guest_name,
             guest_name        = null,
             guest_phone       = null
       where a.unit_id     = v_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    -- 조용히 삼키지는 않는다 — 승계가 계속 실패하면 서버 로그에 남아야 한다(0107 §3 과 같은 태도).
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 4) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다 (0159 §3 · 0160 §4 · 0163 §3)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare v_args text;
begin
  -- ① 선행 의존(0163). 없으면 위 §2 가 이미 실패했겠지만, 왜인지를 여기서 말해 준다.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'cleared_at'
  ) then
    raise exception 'quiz_attempts.cleared_at 이 없다 — 0163 을 먼저 적용해야 한다';
  end if;

  -- ② former_guest_name 이 실제로 붙었나(add column if not exists 는 조용히 넘어간다).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'former_guest_name'
  ) then
    raise exception 'quiz_attempts.former_guest_name 이 없다 — 승계가 제약 위반으로 죽는다';
  end if;

  -- ③ ★이 파일의 핵심 불변식 — 조회 RPC 는 **인자를 하나도 받지 않는다**.
  --    인자가 생기는 순간 아무 번호나 넣어 남의 응시 이력을 조회할 수 있다(§②).
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_guest_quiz_history';
  if v_args is null then
    raise exception 'my_guest_quiz_history 가 없다';
  end if;
  if v_args <> '' then
    raise exception 'my_guest_quiz_history 가 인자(%)를 받는다 — 남의 번호로 조회할 수 있는 문이다', v_args;
  end if;

  -- ④ 로그인 없는 손님(anon)에게 열려 있으면 안 된다. 본인 확인이 auth.uid() 하나뿐이다.
  if has_function_privilege('anon', 'public.my_guest_quiz_history()', 'EXECUTE') then
    raise exception 'my_guest_quiz_history 가 anon 에게 열려 있다';
  end if;

  -- ⑤ 반대쪽 — 너무 조이면 허브의 "매장 없음" 화면이 통째로 빈다.
  if not has_function_privilege('authenticated', 'public.my_guest_quiz_history()', 'EXECUTE') then
    raise exception 'my_guest_quiz_history 를 authenticated 가 부를 수 없다 — 허브 화면이 빈다';
  end if;

  -- ⑥ 승계는 definer RPC 안에서만 일어난다 — quiz_attempts 에 UPDATE·DELETE 정책이 생기면
  --    점수를 고칠 수 있는 문이 열린 것이다(0112 가 일부러 안 만든 것 · 0163 §3-③ 과 같은 검사).
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'quiz_attempts' and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'quiz_attempts 에 UPDATE·DELETE 정책이 생겼다 — 점수를 고칠 수 있는 문이다';
  end if;

  -- ⑦ 0112 의 불변식이 그대로인가. 승계가 이 제약을 우회하려고 제약을 건드리지 않았다는 증명이다.
  if not exists (
    select 1 from pg_constraint
     where conname = 'quiz_attempts_who' and conrelid = 'public.quiz_attempts'::regclass
  ) then
    raise exception 'quiz_attempts_who 제약이 사라졌다 — 0112 의 불변식이 풀렸다';
  end if;
end $$;
