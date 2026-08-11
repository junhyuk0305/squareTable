-- 0139_quiz_schedule.sql — 퀴즈 예약 발송 · 마감 · 재확인 간격 (퀴즈 재설계 2단계)
--
-- 정본: 기획/ux/퀴즈_재설계_데모_2026-08-11.html §B5 + §3 "일정(B5)에 필요한 컬럼 — 3차 수정본"
--       원설계: 산출물/퀴즈시스템_설계_2026-07-29.html §06(주기·빈도 상한) · §11(스키마)
--
-- 왜: 퀴즈에 "언제 보낼지 / 언제까지 풀지"를 담을 곳이 없다. 지금은 직원이 스스로 열 때(자청)만
--     문항이 나가고, 사장이 만든 퀴즈를 **보내는 경로 자체가 없다**.
--
-- 사장이 정하는 것 / 시스템이 정하는 것을 가른다(데모 §B5):
--   · 사장   — 언제 처음 보낼지(start_at) · 언제까지 풀지(answer_days) · 누구에게(quiz_assignments)
--   · 시스템 — 실제 도착 시각(근무일 안에서) · 빈도 상한 · 재확인 간격 확대(interval_step)
--
-- ★ 요일·시각 지정은 **일부러 넣지 않는다**. 사장이 "월요일 오전 9시"로 박으면 그날 쉬는 직원에게
--   쉬는 날 알림이 가고, 원설계의 "근무 아닌 날에는 절대 보내지 않는다"와 정면으로 부딪힌다.
--   도착 시각은 근무표가 정한다(workers_at, 0138 정본).
--
-- ★ 새 크론을 만들지 않는다. 0118 의 task-reminders(5분) 한 갈래에 퀴즈 스윕을 얹는다 —
--   그 경로가 KST 시각·중복 발송 방지·선점 원장·workers_at 근무자 판정을 이미 갖고 있다.
--
-- ⛔ 이 파일은 **사장 발송(예약) 갈래만** 다룬다. 재확인(주기) 자동 출제는 컬럼(interval_step)만
--   신설하고 크론 갈래는 다음 단계다 — 한 마이그레이션에 판정 두 종류를 섞으면 게이트가 red 일 때
--   무엇이 깨졌는지 못 가린다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) 퀴즈(= training_courses) 의 일정 컬럼
-- ════════════════════════════════════════════════════════════════════════
-- 화면 어휘로는 "코스"가 사라지고 퀴즈 1건 = 코스 1건이 된다(데모 §2). DB 이름은 그대로 둔다 —
-- 테이블을 개명하면 quiz_items·course_entries·quiz_links·training_items 의 FK 와 RLS 술어가
-- 전부 따라 움직여야 하고, 얻는 것이 이름뿐이다.
alter table public.training_courses
  add column if not exists start_at    date,
  add column if not exists answer_days int;

comment on column public.training_courses.start_at is
  '예약 발송일(KST 날짜, 0139). null = 예약 없음 → 만든 즉시 발송 대상. 크론은 이 날짜 이후에만 보낸다.
   시각은 담지 않는다 — 실제 도착 시각은 근무표가 정한다(workers_at).';
comment on column public.training_courses.answer_days is
  '마감(며칠 안에, 0139). null = 마감 없음. 기준일은 만든 날이 아니라 **실제로 받은 날**이라
   due_on 은 발송을 선점하는 시점에 claim_quiz_send() 가 계산해 넣는다.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tc_answer_days_positive') then
    alter table public.training_courses
      add constraint tc_answer_days_positive
      check (answer_days is null or answer_days between 1 and 365);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) 재확인 간격 단계
-- ════════════════════════════════════════════════════════════════════════
-- 통과 기록은 (노하우, 직원) 단위(0111)라 간격 단계도 같은 단위다 — 사람마다 잊는 시점이 다르다.
-- ★ 값의 뜻과 상한은 src/lib/quiz/schedule.ts 의 REVIEW_INTERVALS_DAYS 가 SSOT 다.
--   0 = 3일 · 1 = 2주 · 2 = 8주 · 3 = 6개월. 통과하면 +1(상한에서 멈춤), 틀리면 0 으로 되돌린다.
--   ⚠️ 배열을 늘리면 아래 check 도 같이 고친다 — 조용히 어긋나는 것보다 쓰기가 실패하는 편이 낫다.
alter table public.knowhow_understanding
  add column if not exists interval_step int not null default 0;

comment on column public.knowhow_understanding.interval_step is
  '재확인 간격 단계(0139). SSOT = src/lib/quiz/schedule.ts REVIEW_INTERVALS_DAYS [3,14,56,180]일.
   통과 +1 / 오답 0. 사장이 "직접 정할래요"를 고른 퀴즈는 이 단계 대신 training_courses.due_days 고정값을 쓴다.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ku_interval_step_range') then
    alter table public.knowhow_understanding
      add constraint ku_interval_step_range check (interval_step between 0 and 3);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 발송 원장 = quiz_assignments (원설계 §11)
-- ════════════════════════════════════════════════════════════════════════
-- 한 행 = "이 퀴즈를 이 사람에게 이 날짜부터 보낸다". 사장이 발행할 때 수신자 수만큼 만들어지고,
-- 크론이 근무일·빈도 상한을 통과시킬 때 sent_at 을 채운다(= 선점). 즉 수신자 명단과 발송 원장이
-- 같은 행이다 — 나누면 "보냈는데 명단에 없다"·"명단에 있는데 원장에 없다"가 따로 생긴다.
--
-- ★점수 컬럼 없음(원설계 §11). 무엇을 몇 개 맞혔는지는 quiz_attempts(0112)가 갖는다.
create table if not exists public.quiz_assignments (
  id           text primary key default ('qz_' || replace(gen_random_uuid()::text, '-', '')),
  unit_id      text not null references public.units(id) on delete cascade,
  course_id    text not null references public.training_courses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- 이 날짜부터 발송 후보. training_courses.start_at 의 스냅샷 — 사장이 나중에 퀴즈 일정을 바꿔도
  -- 이미 보낸 건의 근거가 흔들리지 않는다.
  scheduled_on date not null,
  -- null = 아직 안 나감. 크론만 채운다(claim_quiz_send).
  sent_at      timestamptz,
  -- 받은 날 + answer_days. answer_days 가 null 이면 여기도 null(마감 없음).
  due_on       date,
  opened_at    timestamptz,
  completed_at timestamptz,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- 같은 퀴즈를 같은 사람에게 같은 예약일로 두 번 만들지 않는다(사장이 발행을 두 번 눌러도 1건).
  unique (course_id, user_id, scheduled_on)
);

-- 크론이 5분마다 훑는 후보 = 아직 안 나간 행뿐. 부분 인덱스로 전량 스캔 방지(0118 idx_wt_remind 와 같은 축).
create index if not exists idx_qz_pending on public.quiz_assignments(scheduled_on)
  where sent_at is null;
-- 빈도 상한 판정(하루 1회·주 2회·연속 무시)이 매번 치는 조회.
create index if not exists idx_qz_sent on public.quiz_assignments(unit_id, user_id, sent_at desc)
  where sent_at is not null;
create index if not exists idx_qz_course on public.quiz_assignments(course_id);

alter table public.quiz_assignments enable row level security;

-- RLS: SELECT = 관리 권한(매장 전체) 또는 본인 것. 직원끼리 서로의 퀴즈 진행은 안 보인다
--      (training_requests 0102 · quiz_attempts 0112 와 같은 기준 — 상호 비교 노출 회피).
--      INSERT·UPDATE·DELETE = 관리 권한만. 직원이 자기 행을 고칠 수 있으면 sent_at·due_on 을
--      되돌려 마감을 무력화할 수 있다 — 컬럼 단위 제한은 RLS 로 못 하므로 쓰기 자체를 막는다.
--
-- ⚠️ opened_at·completed_at 을 쓰는 경로는 아직 없다(응시 화면이 5단계). 그때 definer RPC 로
--    "본인의 그 행만, 그 두 칸만" 채우게 붙인다 — RLS 를 열어 주는 방식으로 하지 않는다.
--
-- ★★ unit_id 만 보면 부족하다 — course_id 는 텍스트 FK 라 **존재만 검사**하고 소유는 검사하지
--    않는다. 참조 대상이 내 매장 것인지, 받는 사람이 내 매장 멤버인지도 함께 검사한다.
--    EXISTS 는 호출자 RLS 를 타므로 남의 매장 행은 애초에 안 보인다 = fail-closed.
--
-- ★★★ EXISTS 안의 바깥 컬럼은 **반드시 테이블명으로 한정한다**(quiz_assignments.unit_id).
--    한정하지 않으면 SQL 스코프 규칙상 안쪽 FROM 이 먼저 이긴다 — `c.unit_id = unit_id` 는
--    training_courses 에도 unit_id 가 있으므로 `c.unit_id = c.unit_id` 가 되어 **항상 참**이다.
--    소유 검사가 조용히 무효가 되고 FK 존재 검사만 남는다(= 막으려던 구멍이 그대로 열린다).
--    0111 course_entries · 0112 quiz_attempts 의 같은 자리에 이 형태가 남아 있다 — 별건으로 확인 필요.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists qz_select on public.quiz_assignments;
    create policy qz_select on public.quiz_assignments
      for select using (
        unit_id = (select public.auth_unit_id())
        and (user_id = (select auth.uid()) or (select public.auth_can_manage()))
      );

    drop policy if exists qz_insert on public.quiz_assignments;
    create policy qz_insert on public.quiz_assignments
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (
          select 1 from public.training_courses c
           where c.id = quiz_assignments.course_id
             and c.unit_id = quiz_assignments.unit_id
        )
        and exists (
          select 1 from public.unit_members m
           where m.unit_id = quiz_assignments.unit_id
             and m.user_id = quiz_assignments.user_id
        )
      );

    drop policy if exists qz_update on public.quiz_assignments;
    create policy qz_update on public.quiz_assignments
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (
          select 1 from public.training_courses c
           where c.id = quiz_assignments.course_id
             and c.unit_id = quiz_assignments.unit_id
        )
        and exists (
          select 1 from public.unit_members m
           where m.unit_id = quiz_assignments.unit_id
             and m.user_id = quiz_assignments.user_id
        )
      );

    drop policy if exists qz_delete on public.quiz_assignments;
    create policy qz_delete on public.quiz_assignments
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- realtime: 직원 화면이 "퀴즈 도착"을 즉시 띄우려면 구독이 필요하다. 클라가 subscribe 하는 테이블은
-- publication 멤버여야 한다(AGENTS.md ⑤) — 지금 등록해 두지 않으면 5단계에서 "실시간이 조용히 죽는다".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quiz_assignments'
  ) then
    alter publication supabase_realtime add table public.quiz_assignments;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 지금 보낼 퀴즈 — due_quiz_sends()
-- ════════════════════════════════════════════════════════════════════════
-- due_task_reminders(0118)의 퀴즈 판. 수신자 규칙 SSOT = 이 함수 한 곳(AGENTS.md ②).
-- OUT 파라미터명은 컬럼명과 겹치지 않게 out_ 접두(0040 의 42702 선례).
--
-- ★ 빈도 상한 상수는 src/lib/quiz/schedule.ts 가 SSOT 다. 여기 숫자는 그 사본이며 **바꿀 때 양쪽을
--   같이 고친다**(schedule.ts 머리말의 명시적 요구 · 0138 에서 겪은 드리프트 방지):
--     MAX_SENDS_PER_DAY = 1 · MAX_SENDS_PER_WEEK = 2 · AUTO_STOP_AFTER_IGNORED = 2
--
-- 상한을 (unit_id, user_id) 단위로 센다. 사람 단위로 세면 A매장 퀴즈가 B매장 퀴즈를 조용히 굶기고,
-- 한쪽 매장의 발송 타이밍이 다른 매장 판정에 새어 든다(다점포 직원은 드물지만 결합은 비가역이다).
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

-- 전 매장을 훑는 전역 함수 — 클라이언트가 호출할 이유가 없다(0118 due_task_reminders 와 같은 원칙).
revoke execute on function public.due_quiz_sends() from public, anon, authenticated;
grant  execute on function public.due_quiz_sends() to service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 5) 발송 선점 — claim_quiz_send()
-- ════════════════════════════════════════════════════════════════════════
-- 0118 은 task_reminder_sent 에 insert 해 선점한다(PK 충돌 = 잠금). 여기는 원장이 곧 대상 행이므로
-- **조건부 update** 가 그 역할을 한다 — `sent_at is null` 술어가 붙은 단일 UPDATE 라 원자적이고,
-- 두 번째 실행은 0행을 갱신하며 false 를 받는다. 발송 후 기록으로 하면 그 사이에 다른 실행이 끼어든다.
--
-- due_on 을 여기서 계산하는 이유: 마감의 기준일은 만든 날이 아니라 **실제로 받은 날**이다(데모 B5
-- "받은 날부터 3일 안에"). 예약이 근무일을 기다려 며칠 밀리면 마감도 같이 밀려야 한다.
create or replace function public.claim_quiz_send(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_days int;
  v_n    int;
begin
  select c.answer_days into v_days
    from public.quiz_assignments a
    join public.training_courses c on c.id = a.course_id
   where a.id = p_id;

  update public.quiz_assignments a
     set sent_at = now(),
         due_on  = case when v_days is null then null
                        else ((now() at time zone 'Asia/Seoul')::date + v_days) end
   where a.id = p_id and a.sent_at is null;

  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

revoke execute on function public.claim_quiz_send(text) from public, anon, authenticated;
grant  execute on function public.claim_quiz_send(text) to service_role;
