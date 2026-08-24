-- 0169_quiz_triggers_join_change.sql — 퀴즈 출제 계기 2종을 붙인다: **입사** · **변경**
--
-- 정본: 산출물/퀴즈시스템_설계_2026-07-29.html §06 "네 가지 계기 — 입사 · 변경 · 주기 · 자청"
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 원설계의 네 계기 중 지금 도는 것은 **자청**(직원이 스스로 연다) · **사장 수동 발행**(0139) ·
-- **주기**(예약일이 오면 크론이 근무일에 내보낸다, 0139)뿐이다. 남은 둘:
--   · 입사 — 새 직원이 합류하면 첫 퀴즈가 자동으로 배정된다. 지금은 사장이 발행을 눌러야만 나간다.
--   · 변경 — 사장이 노하우를 고치면, 그 노하우를 **이미 통과한** 직원에게 다시 확인이 나간다.
--            지금은 통과 기록이 그대로 남아 "옛날 판을 아는 사람"이 영원히 "아는 사람"이다.
--
-- ⛔ 새 발송 메커니즘을 만들지 않는다. 두 계기 모두 **0139 의 발송 원장(quiz_assignments)에 행을
--    하나 넣는 것**으로 끝난다. 근무일 판정 · 하루 1회 · 주 2회 · 연속 무시 시 자동 정지 ·
--    선점(claim_quiz_send) · 마감 계산은 이미 그 경로가 전부 갖고 있다. 계기가 늘어도
--    "언제 실제로 도착하나"의 판정은 due_quiz_sends() 한 곳이다(AGENTS.md ② SSOT).
--
-- ⛔ 델타 출제("바뀐 칸만 1문항")는 이번 스코프가 아니다. 변경 트리거는 "다시 확인이 나간다"까지만
--    하고, 무슨 문항을 낼지는 기존 출제 경로(quiz_items_for)가 그대로 정한다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ② 감시 도구로 만들지 않는다 (0103 이 계속 지켜 온 선)
-- ══════════════════════════════════════════════════════════════════════════
-- 이 파일은 **개인별 오답·미이행 이력을 한 칸도 만들지 않는다.** origin 은 "이 발송이 왜 생겼나"
-- 하나만 담고, 사람에 대한 판정("아직 안 했다"·"또 안 열었다")은 어디에도 저장하지 않는다.
-- 재확인은 **다시 확인할 기회**지 못 한 사람을 표시하는 것이 아니다.
-- 재촉도 하지 않는다 — 안 열면 0139 의 자동 정지(연속 2회)가 조용히 멈춘다. 그게 이 시스템의
-- 유일한 독촉 정책이고, 여기서 새로 만들지 않는다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ③ 폭주 방지 — 이 파일의 절반은 이것이다
-- ══════════════════════════════════════════════════════════════════════════
-- 사장이 노하우 10건을 한 번에 고치면(섹션 이름 바꾸기 한 번이면 그 섹션 노하우 전부의
-- updated_at 이 함께 밀린다 — db.ts renameSection) 직원 한 명에게 퀴즈 10개가 쏟아질 수 있다.
-- 상한 세 겹을 **만드는 쪽**에 건다(보내는 쪽 상한은 0139 것을 그대로 쓴다):
--   ⓐ 한 스윕에 (매장,직원)당 1건    — distinct on
--   ⓑ 대기 중인 재확인이 있으면 더 안 만든다(sent_at is null)
--   ⓒ (매장,직원)당 **7일에 1건**    — MAX_AUTO_RECHECKS_PER_WEEK
-- ⓒ 의 근거: 주 상한이 2회(MAX_SENDS_PER_WEEK)인데 재확인은 **시스템이 스스로 만드는 유일한
--   갈래**라, 상한이 없으면 재확인이 그 2칸을 다 먹고 사장이 직접 보낸 퀴즈가 영영 밀린다.
--   절반(주 1회)만 쓴다. ★값의 SSOT 는 src/lib/quiz/schedule.ts 이고 아래 숫자는 그 사본이다 —
--   **바꿀 때 양쪽을 같이 고친다**(0138 에서 겪은 드리프트 · 0139 머리말과 같은 요구).
-- 입사도 같은 태도다: 합류 즉시 **코스 1개**만 배정한다(JOIN_FIRST_QUIZ_COURSES).
--   첫날에 전부 쏟으면 그날 앱을 끈다 — 나머지는 사장 발행과 주기가 이어받는다.


-- ════════════════════════════════════════════════════════════════════════
-- 1) origin — 이 발송이 왜 생겼나
-- ════════════════════════════════════════════════════════════════════════
-- 상한(③ⓑⓒ)을 재확인 갈래에만 걸려면 갈래를 구분할 칸이 필요하다. 사람에 대한 값이 아니라
-- **발송 자체의 출처**다(②). 기본값 'manual' 이라 기존 행·사장 발행 경로는 한 줄도 안 바뀐다.
alter table public.quiz_assignments
  add column if not exists origin text not null default 'manual';

comment on column public.quiz_assignments.origin is
  '이 발송이 생긴 계기(0169). manual=사장이 직접 발행 · join=입사 트리거 · recheck=노하우 변경 트리거.
   ★사람에 대한 판정이 아니다 — 폭주 상한을 재확인 갈래에만 걸기 위한 출처 표시다(0103 의 선).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qz_origin_known') then
    alter table public.quiz_assignments
      add constraint qz_origin_known check (origin in ('manual', 'join', 'recheck'));
  end if;
end $$;

-- ③ⓑⓒ 가 매 스윕마다 치는 조회. 재확인 행만 보면 되므로 부분 인덱스(0139 idx_qz_pending 과 같은 축).
create index if not exists idx_qz_recheck
  on public.quiz_assignments(unit_id, user_id, created_at desc)
  where origin = 'recheck';


-- ════════════════════════════════════════════════════════════════════════
-- 2) 변경 트리거 — enqueue_knowhow_rechecks()
-- ════════════════════════════════════════════════════════════════════════
-- 무엇을 "변경"으로 볼 것인가: **새 감지 방식을 만들지 않는다.** 이미 두 재료가 있다.
--   ⓐ playbook_entries.updated_at   — 0114 가 "노하우가 언제 판이 바뀌었나"의 기준으로 쓰는 값
--                                     (사장 화면의 낡음 배지 · useQuizBoard.staleCountOf 가 같은 값을 본다)
--   ⓑ knowhow_understanding.verified_at — 그 사람이 **언제 통과했나**(0111)
-- 이미 통과한 직원 = ⓑ 가 있는 사람. 그 뒤에 바뀌었다 = ⓐ > ⓑ. 이게 판정 전부다.
--
-- ★★ 그런데 **낡은 문항을 그대로 다시 보내면 안 된다.** 0114 가 못박은 문제가 정확히 그것이다 —
--    "노하우를 고쳐도 옛 정답이 계속 출제되고, 그 결과로 오르는 오답률을 시스템이 정반대로
--    진단한다." 0114 는 자동 재생성을 금지하고 사장의 [다시 만들기](=검수)를 기다린다.
--    그래서 재확인은 **그 노하우를 근거로 하는 활성 문항의 스냅샷이 최신일 때만** 나간다
--    (quiz_items.source_updated_at >= playbook_entries.updated_at). 즉 사장이 검수를 마친 순간이
--    곧 "다시 물어봐도 되는 순간"이다. 검수 전에는 조용히 기다린다 — 이게 이 갈래의 4번째 상한이다.
--
-- 어디에 거나: 크론(0118 task-reminders 5분)이 이미 due_quiz_sends() 를 부른다. **새 크론도,
-- 엣지 함수 변경도 만들지 않는다** — §3 에서 due_quiz_sends() 가 첫 줄에 이 함수를 부른다.
create or replace function public.enqueue_knowhow_rechecks()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  r       record;
  v_made  int := 0;
begin
  for r in
    -- ③ⓐ 한 스윕에 (매장,직원)당 1건. 가장 최근에 바뀐 노하우가 담긴 코스를 고른다.
    select distinct on (ku.unit_id, ku.staff_id)
           ku.unit_id as unit_id, ku.staff_id as staff_id, ce.course_id as course_id
      from public.knowhow_understanding ku
      join public.playbook_entries pe
        on pe.id = ku.entry_id and pe.unit_id = ku.unit_id
      -- 발송 단위는 코스다(0111 course_entries). 어느 코스에도 안 담긴 노하우는 보낼 자리가 없다 —
      -- 문항을 즉석에서 만들어 내지 않는다(⛔델타 출제 금지와 같은 선).
      join public.course_entries ce
        on ce.entry_id = ku.entry_id and ce.unit_id = ku.unit_id
      join public.training_courses c
        on c.id = ce.course_id and c.active
      join public.units u
        on u.id = ku.unit_id and u.deleted_at is null
      join public.unit_members m
        on m.unit_id = ku.unit_id and m.user_id = ku.staff_id
     where
       -- ── 변경 감지(위 ⓐ>ⓑ) ────────────────────────────────────────────
           pe.updated_at > ku.verified_at
       -- 초안은 아직 매장의 정답이 아니다. 발행된 것만 다시 묻는다.
       and pe.status = 'published'
       -- ★적용 첫날 폭주 방지. 이 조건이 없으면 **과거 전체의 수정 이력**이 한꺼번에 살아나
       --   모든 매장의 모든 직원에게 동시에 재확인이 생긴다. 오래된 변경은 이미 일상에서
       --   흡수됐다고 본다 — 14일은 주 상한(7일)의 두 배로, 한 주를 통째로 놓쳐도 살아남는 폭이다.
       and pe.updated_at > now() - interval '14 days'
       -- 사장 자신에게는 안 보낸다. 고친 사람이 자기 매장 노하우를 다시 확인받는 것은 의미가 없고,
       -- 사장 폰에 자기가 누른 수정만큼 알림이 오면 그것부터 끈다.
       and m.role <> 'owner'
       -- ★★ 문항이 검수돼 최신인가(0114 재사용). 낡은 문항으로 다시 물으면 옛 정답을 채점한다.
       and exists (
         select 1 from public.quiz_items qi
          where qi.unit_id = ku.unit_id
            and qi.status = 'active'
            and ku.entry_id = any(qi.entry_ids)
            and qi.source_updated_at is not null
            and qi.source_updated_at >= pe.updated_at
       )
       -- ③ⓑ 대기 중인 재확인이 있으면 더 만들지 않는다. 사장이 10건을 고쳐도 큐에는 1건뿐이다.
       and not exists (
         select 1 from public.quiz_assignments x
          where x.unit_id = ku.unit_id and x.user_id = ku.staff_id
            and x.origin = 'recheck' and x.sent_at is null
       )
       -- ③ⓒ (매장,직원)당 7일에 1건 (= MAX_AUTO_RECHECKS_PER_WEEK, SSOT: src/lib/quiz/schedule.ts).
       and not exists (
         select 1 from public.quiz_assignments x
          where x.unit_id = ku.unit_id and x.user_id = ku.staff_id
            and x.origin = 'recheck'
            and x.created_at > now() - interval '7 days'
       )
     order by ku.unit_id, ku.staff_id, pe.updated_at desc, ce.position, ce.course_id
  loop
    -- scheduled_on = 오늘. "오늘부터 발송 후보"라는 뜻이고, 실제 도착일은 근무표가 정한다(0139).
    -- created_by = null → 시스템이 만든 행(사장 발행은 auth.uid() 가 찍힌다).
    insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
    values (r.unit_id, r.course_id, r.staff_id, v_today, 'recheck', null)
    on conflict (course_id, user_id, scheduled_on) do nothing;
    if found then v_made := v_made + 1; end if;
  end loop;

  return v_made;
end $$;

-- 전 매장을 훑고 **쓰는** 함수다. 클라이언트가 부를 이유가 없다(0139 due_quiz_sends 와 같은 원칙).
-- ⛔ from public 만 쓰면 안 닫힌다 — Supabase 는 anon·authenticated 에 **직접** 부여한다(0159·0166 실측).
revoke all on function public.enqueue_knowhow_rechecks() from public, anon, authenticated;
grant  execute on function public.enqueue_knowhow_rechecks() to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 3) due_quiz_sends() 재정의 — 스윕 첫 줄에서 재확인을 큐에 넣는다
-- ════════════════════════════════════════════════════════════════════════
-- ★아래 본문은 **0139 정본을 한 글자도 바꾸지 않고 그대로 옮긴 것**이고, 맨 앞의 §0 블록 하나만
--  새로 붙었다(0115 가 0093 대신 옛 베이스를 잡아 qa:roles 를 11개 깨뜨린 선례를 피한다).
--  전수 grep: due_quiz_sends 는 0139 에만 정의돼 있었다 → 이 파일이 새 정본이다.
--
-- 왜 여기인가: 크론(0118 task-reminders)이 5분마다 부르는 유일한 퀴즈 진입점이 이 함수다.
-- 엣지 함수(supabase/functions/push)를 고치면 **재배포 전까지 갈래가 안 돈다** — 배포 시점과
-- 마이그레이션 시점이 어긋나면 "적용했는데 아무 일도 안 일어난다"가 된다. DB 안에 두면
-- 마이그레이션 하나로 계기가 살아난다.
--
-- 왜 예외를 삼키나: 재확인 큐잉이 실패해도 **사장이 직접 발행한 퀴즈는 나가야 한다**. 여기서
-- 예외가 새면 스윕 전체가 죽어 할일 리마인더 갈래까지 같이 멈춘다(0118 과 한 크론이다).
-- 조용히 삼키지는 않는다 — warning 으로 서버 로그에 남긴다(0165 승계 블록과 같은 태도).
create or replace function public.due_quiz_sends()
returns table (
  out_assignment_id text,
  out_unit_id       text,
  out_user_id       text,
  out_course_name   text
) language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamp := (now() at time zone 'Asia/Seoul');
  v_date   date := v_now::date;
  v_day    text := to_char(v_now, 'YYYY-MM-DD');
  v_time   text := to_char(v_now, 'HH24:MI');
  a        record;
  h        record;
  v_streak int;
  -- 이번 스윕에서 이미 뽑은 (매장,사람). 아직 sent_at 이 안 찍혔으므로 원장 조회만으로는
  -- 같은 사람이 한 스윕에 2건 뽑히는 것을 못 막는다(하루 1회가 조용히 깨지는 경로다).
  v_taken  text[] := '{}';
  v_key    text;
begin
  -- ── §0 (0169) 변경 트리거: 후보를 고르기 **전에** 큐를 채운다 ──────────────
  --    이 순서라야 방금 검수가 끝난 재확인이 같은 스윕에서 바로 후보가 된다(5분 더 안 기다린다).
  begin
    perform public.enqueue_knowhow_rechecks();
  exception when others then
    raise warning 'knowhow recheck enqueue skipped: %', sqlerrm;
  end;

  for a in
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       and c.active
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
     order by qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    if exists (select 1 from public.shift_templates st where st.unit_id = a.unit_id) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창).
    if (
      select count(*) from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'
    ) >= 2 then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then continue; end if;

    v_taken := v_taken || v_key;
    out_assignment_id := a.id;
    out_unit_id       := a.unit_id;
    out_user_id       := a.user_id::text;
    out_course_name   := a.course_name;
    return next;
  end loop;
end $$;

-- create or replace 는 기존 권한을 보존하지만, 0159·0166 의 교훈대로 **말만 하지 않고 다시 닫는다**.
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant  execute on function public.due_quiz_sends() to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 4) 입사 트리거 — approve_member 재정의
-- ════════════════════════════════════════════════════════════════════════
-- ★signup-drift ③: 정의 전수 grep 결과 approve_member 는 0032·0038·0056·0062·0067·0093·0115·
--   0117·0165 에 걸쳐 재정의돼 있고 **최고 번호 0165 가 정본**이다. 아래는 **0165 본문 전체를
--   그대로 베이스**로 하고 §입사 블록만 덧붙인 것이다 — 좌석 캡(0115·0117) · 승인권(0093) ·
--   unit_members 기록 · 게스트 이력 승계(0165)는 한 줄도 바꾸지 않았다.
--   (0115 가 0093 대신 0062 를 베이스로 삼아 qa:roles 를 11개 깨뜨린 선례.)
--
-- 왜 join_by_invite 가 아니라 여기인가: join_by_invite 는 pending_unit_id 만 세운다 —
-- 그 시점은 합류가 아니라 **신청**이다. 신청 단계에 퀴즈를 배정하면 승인 안 된 사람에게
-- 매장 노하우 문항이 나간다. 소속이 확정되는 곳은 approve_member 하나뿐이다.
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_plan   text;
  v_staff  int;
  v_phone  text;
  v_course text;
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
  -- 이 매장에서 **같은 전화번호로 링크를 풀었던 행**의 주인을 이 직원으로 바꾼다(0165 §③).
  -- ★합류가 본 목적이고 승계는 부가다 — 여기서 무슨 일이 나도 합류를 되돌리지 않는다.
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
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;

  -- ── 0169: 입사 트리거 — 첫 퀴즈 1개를 배정한다 ─────────────────────────────
  -- ★**코스 1개만.** 첫날에 전부 쏟으면 그날 앱을 끈다(원설계 §06 빈도 상한이 지키려는 것과 같은
  --   실패다). 나머지는 사장 발행과 주기가 이어받는다. 값의 SSOT = schedule.ts
  --   JOIN_FIRST_QUIZ_COURSES.
  -- 고르는 순서: 신입용 코스(key/preset='first_day') → position → 만든 순.
  --   담긴 노하우가 하나도 없는 코스는 건너뛴다 — 빈 퀴즈가 도착하면 첫인상이 그걸로 끝난다.
  -- 실제 도착은 여기서 정하지 않는다. scheduled_on = 오늘이고, 근무일·빈도 상한을 통과할 때
  --   크론이 내보낸다(0139) — 합류가 쉬는 날이면 다음 근무일에 간다.
  -- ★합류가 본 목적이다(위 승계 블록과 같은 태도) — 배정이 실패해도 합류를 되돌리지 않는다.
  begin
    select c.id into v_course
      from public.training_courses c
     where c.unit_id = v_unit
       and c.active
       and exists (select 1 from public.course_entries ce where ce.course_id = c.id)
     order by (case when c.key = 'first_day' or c.preset = 'first_day' then 0 else 1 end),
              c.position, c.created_at, c.id
     limit 1;

    if v_course is not null then
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
      values (v_unit, v_course, p_uid, (now() at time zone 'Asia/Seoul')::date, 'join', v_uid)
      on conflict (course_id, user_id, scheduled_on) do nothing;
    end if;
  exception when others then
    raise warning 'join quiz assignment skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 5) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다 (0159 §3 · 0166 §2)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src  text;
  v_role text;
begin
  -- ① origin 이 실제로 붙었나(add column if not exists 는 조용히 넘어간다).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quiz_assignments' and column_name = 'origin'
  ) then
    raise exception 'quiz_assignments.origin 이 없다 — 폭주 상한이 갈래를 구분할 수 없다';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qz_origin_known') then
    raise exception 'qz_origin_known 제약이 없다 — origin 에 아무 값이나 들어간다';
  end if;

  -- ② 새 스윕 함수는 클라에 열려 있으면 안 된다. **from public 만으로는 안 닫힌다**(0159 실측).
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.enqueue_knowhow_rechecks()', 'EXECUTE') then
      raise exception '전역 스윕 함수가 %에게 열려 있다: enqueue_knowhow_rechecks()', v_role;
    end if;
    if has_function_privilege(v_role, 'public.due_quiz_sends()', 'EXECUTE') then
      raise exception '전역 스윕 함수가 %에게 열려 있다: due_quiz_sends()', v_role;
    end if;
  end loop;

  -- ③ 반대쪽 — 너무 조여서 크론이 못 돌면 퀴즈 발송이 통째로 죽는다.
  if not has_function_privilege('service_role', 'public.enqueue_knowhow_rechecks()', 'EXECUTE') then
    raise exception 'service_role 이 enqueue_knowhow_rechecks 를 못 부른다 — 크론이 멈춘다';
  end if;
  if not has_function_privilege('service_role', 'public.due_quiz_sends()', 'EXECUTE') then
    raise exception 'service_role 이 due_quiz_sends 를 못 부른다 — 크론이 멈춘다';
  end if;

  -- ④ ★변경 갈래가 크론 경로에 실제로 붙어 있나. 훗날 누가 due_quiz_sends 를 0139 본문으로
  --    되돌리면(정본 드리프트) 이 계기가 조용히 사라진다 — 그때 여기서 멈춘다.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'due_quiz_sends';
  if v_src is null or position('enqueue_knowhow_rechecks' in v_src) = 0 then
    raise exception 'due_quiz_sends 가 재확인 큐잉을 부르지 않는다 — 변경 트리거가 죽었다';
  end if;

  -- ⑤ approve_member 정본 회귀 검사. 입사 블록을 얹으면서 앞선 계층을 떨어뜨리지 않았는가
  --    (0115 가 unit_members insert 를 빠뜨려 qa:roles 11개를 깨뜨린 자리다).
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approve_member';
  if v_src is null then raise exception 'approve_member 가 없다'; end if;
  if position('unit_members' in v_src) = 0 then
    raise exception 'approve_member 가 unit_members 를 기록하지 않는다 — 0093/0115 회귀';
  end if;
  if position('former_guest_name' in v_src) = 0 then
    raise exception 'approve_member 에서 게스트 이력 승계가 사라졌다 — 0165 회귀';
  end if;
  if position('effective_plan' in v_src) = 0 then
    raise exception 'approve_member 에서 좌석 캡이 사라졌다 — 0115/0117 회귀';
  end if;
  if position('quiz_assignments' in v_src) = 0 then
    raise exception 'approve_member 에 입사 트리거가 없다 — 0169 가 안 붙었다';
  end if;
  if not has_function_privilege('authenticated', 'public.approve_member(uuid)', 'EXECUTE') then
    raise exception 'approve_member 를 authenticated 가 못 부른다 — 승인이 통째로 죽는다';
  end if;
end $$;
