-- 0348 다시 알리기 두 결함 (2026-11-03 사용자 결정)
-- 옛 앱 호환: 안전 | 테이블은 열 추가만(quiz_assignments.count_from · 기본 null = 옛 뜻 그대로 sent_at).
--   옛 클라(main 웹 · ios-v1.0.1 · android-v1.0.3)는 quiz_assignments 를 열 목록(QUIZ_ASSIGNMENT_COLS)으로 읽고,
--   quiz_assignment_progress · quiz_assignment_items · mark_quiz_completed · my_units_notif_data 를 부른다(db.ts grep).
--   이 파일은 그 함수들의 이름·인자·반환 열을 안 바꾼다. 바뀌는 것은 판정 두 곳의 "언제부터 세나" 하나다.
--   새 RPC quiz_assignment_restart 는 새 앱만 부른다. 옛 앱은 안 부르므로 기본 동작(이어 풀기)을 탄다.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   규칙 "이 발송의 진행을 어느 시점부터 세나"가 서버에서 sent_at 으로 박혀 있었다(0332 pending · state).
--   다시 알리기는 새 발송 1건이다(a3fd6d3). 그래서
--   ① 푸는 중에 다시 알리기가 나가면 새 발송의 sent_at 부터 다시 세서 진행이 0 이 됐다.
--   ② 안 나간 다시 알리기 행은 그 사이 완료를 모른 채 due_quiz_sends 후보로 남아, 완료자에게 알림·todo 가 다시 생겼다.
--
-- 고친 것
--   ⓐ 집계 시작 시각 SSOT = quiz_assignment_count_from(행) = coalesce(count_from, sent_at).
--      서버에서 "언제부터"를 보는 곳은 pending 과 state 둘뿐이다(0332 함수 담당표 · grep 전수).
--      progress · items · mark_quiz_completed · 허브 알림(my_units_notif_data)은 그 둘을 거쳐서 저절로 같은 답을 낸다.
--      클라 짝 = src/lib/quiz/progress.ts countFromOf (사장 결과 personState · latestCourseAnswers 가 쓴다).
--   ⓑ 이어 풀기가 기본이다. 다시 알리기(origin manual) 발송이 나가는 순간 트리거가 count_from 을 정한다.
--      바로 앞 나간 발송이 미완료이고 그 회차에 답이 하나라도 있으면 → 앞 회차의 집계 시작 시각을 물려받는다.
--      아니면 null(= sent_at). 재확인(recheck)·입사(join)는 물려받지 않는다. 재확인은 노하우가 바뀌어 다시 푸는 것이다.
--      발송 시각은 claim_quiz_send 한 곳에서만 찍히지만, 트리거로 두면 어떤 경로로 찍혀도 같은 규칙을 탄다.
--   ⓒ 처음부터 다시 풀기 = quiz_assignment_restart(발송 id) · 본인의 이어 풀기 중인 발송만 count_from = now().
--      버튼 조건(서버 근거) = 미완료 · count_from < sent_at. 다시 풀면 count_from >= sent_at 이라 조건이 꺼진다.
--   ⓓ due_quiz_sends: 안 나간 manual 행은 그 행이 생긴 뒤 같은 (퀴즈, 사람)의 발송이 완료되면 후보에서 뺀다.
--      재확인 행은 빼지 않는다(노하우가 바뀌었으면 완료자도 다시 풀어야 한다 · 0169 변경 트리거의 목적).
--
-- 첫 응시 정답률(10-22 Q2)은 바뀌지 않는다. quiz_course_stats 의 first_* 는 발송과 무관하게 사람·문항마다 가장 이른 답이다.
--   처음부터 다시 풀어도 그 사람의 첫 답은 그대로이고, 다시 푼 답은 정답률에 안 들어간다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): quiz_assignment_pending 0332→0348 · quiz_assignment_state 0332→0348 ·
--   due_quiz_sends 0332→0348. 새: quiz_assignment_count_from · quiz_assignment_carry_count_from(트리거) · quiz_assignment_restart.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── 집계 시작 시각 열 ──
alter table public.quiz_assignments add column if not exists count_from timestamptz;
comment on column public.quiz_assignments.count_from is
  '이 발송의 진행을 세기 시작하는 시각(0348). null = sent_at. 다시 알리기가 미완료 회차를 이어받으면 앞 회차의 시작 시각,
   직원이 처음부터 다시 풀기를 누르면 그 시각. 읽는 곳은 quiz_assignment_count_from 하나다.';

-- ── ⓐ SSOT ──
create or replace function public.quiz_assignment_count_from(a public.quiz_assignments)
returns timestamptz language sql immutable set search_path = public as $$
  select coalesce(a.count_from, a.sent_at)
$$;
revoke all on function public.quiz_assignment_count_from(public.quiz_assignments) from public, anon, authenticated;

-- ── ⓑ 발송이 나가는 순간 집계 시작 시각을 정한다 ──
-- 앞 회차 = 같은 (매장, 퀴즈, 사람)의 나간 발송 중 가장 늦은 것(이 행 제외).
-- 사장이 미리 넣은 값은 믿지 않는다. 나가는 순간 이 규칙으로 덮는다(qz_update 는 관리 권한이 모든 열을 쓸 수 있다).
create or replace function public.quiz_assignment_carry_count_from()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev public.quiz_assignments;
begin
  if new.sent_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.sent_at is not null then return new; end if;
  new.count_from := null;
  if new.origin is distinct from 'manual' then return new; end if;
  select * into prev from public.quiz_assignments x
   where x.unit_id = new.unit_id and x.course_id = new.course_id and x.user_id = new.user_id
     and x.id <> new.id and x.sent_at is not null and x.sent_at <= new.sent_at
   order by x.sent_at desc limit 1;
  if not found or prev.completed_at is not null then return new; end if;
  if exists (
    select 1 from public.quiz_attempt_items ai
     where ai.unit_id = prev.unit_id and ai.staff_id = prev.user_id and ai.course_id = prev.course_id
       and not ai.self_check and ai.created_at >= public.quiz_assignment_count_from(prev)
  ) then
    new.count_from := public.quiz_assignment_count_from(prev);
  end if;
  return new;
end $$;
revoke all on function public.quiz_assignment_carry_count_from() from public, anon, authenticated;
drop trigger if exists trg_quiz_assignment_carry_count_from on public.quiz_assignments;
create trigger trg_quiz_assignment_carry_count_from
  before insert or update of sent_at on public.quiz_assignments
  for each row execute function public.quiz_assignment_carry_count_from();

-- ── 진행: 집계 시작 시각 뒤 낸 답 (베이스 = 0332 · created_at 기준만 바꿨다) ──
-- 본인이 발송 후 낸 답만 센다. 전체 이해 기록이나 다른 코스의 답으로 대체하지 않는다.
-- ★0332: 자청 답(self_check)은 세지 않는다(Q1). 퀴즈가 멈추면(①) servable 이 0개라 total 0 이다.
-- ★0348: "발송 후"의 시작 = quiz_assignment_count_from(ⓐ). 이어 풀기면 앞 회차부터, 다시 풀기면 누른 때부터다.
create or replace function public.quiz_assignment_pending(p_assignment_id text)
returns table(item_id text,entry_ids text[],answered boolean)
language sql stable security definer set search_path = public as $$
  select q.id,q.entry_ids,exists(select 1 from public.quiz_attempt_items ai
    where ai.unit_id=a.unit_id and ai.staff_id=a.user_id
      and ai.course_id=a.course_id and not ai.self_check
      and ai.item_id=q.id and ai.created_at>=public.quiz_assignment_count_from(a))
    from public.quiz_assignments a
    cross join lateral public.quiz_course_servable(a.unit_id,a.course_id) q
   where a.id=p_assignment_id and a.sent_at is not null
$$;
revoke all on function public.quiz_assignment_pending(text) from public,anon,authenticated;

-- ── ③ 이 발송의 상태 (베이스 = 0332 · done 갈래의 시작 시각만 바꿨다) ──
-- 완료된 발송은 남은 문항을 다시 세지 않는다(N07). total=answered=그 발송 기간에 답한 문항 수다.
-- void = 낼 문항 0개(문항이 간접으로 0개가 됐거나 퀴즈가 보관·숨김). 0327 의 "0문항은 완료로 닫지 않는다"를 그대로 이름 붙였다.
--   벨·홈·카드는 void 를 할 퀴즈로 세지 않는다. 되살리면 다시 todo 가 된다.
-- ★0348: 발송 기간의 시작 = quiz_assignment_count_from(ⓐ).
create or replace function public.quiz_assignment_state(p_assignment_id text)
returns table(total_items int, answered_items int, state text)
language plpgsql stable security definer set search_path = public as $$
declare a public.quiz_assignments; v_total int := 0; v_answered int := 0;
begin
  select * into a from public.quiz_assignments x where x.id = p_assignment_id and x.sent_at is not null;
  if not found then return; end if;
  if a.completed_at is not null then
    select count(distinct ai.item_id)::int into v_answered from public.quiz_attempt_items ai
     where ai.unit_id = a.unit_id and ai.staff_id = a.user_id and ai.course_id = a.course_id and not ai.self_check
       and ai.created_at >= public.quiz_assignment_count_from(a) and ai.created_at <= a.completed_at;
    total_items := v_answered; answered_items := v_answered; state := 'done';
    return next; return;
  end if;
  select count(*)::int, count(*) filter (where p.answered)::int into v_total, v_answered
    from public.quiz_assignment_pending(a.id) p;
  total_items := v_total; answered_items := v_answered;
  state := case when v_total = 0 then 'void' when v_answered >= v_total then 'answered' else 'todo' end;
  return next;
end $$;
revoke all on function public.quiz_assignment_state(text) from public, anon, authenticated;

-- ── ⓒ 처음부터 다시 풀기 (새 RPC · 새 앱만 부른다) ──
-- 본인 · 활성 매장 · 나간 발송 · 미완료 · 이어 풀기 중(count_from < sent_at)일 때만 true.
-- 그 밖(남의 것 · 없음 · 완료 · 이미 처음부터)은 false. 같은 버튼을 두 번 눌러도 한 번만 바뀐다(행 잠금).
create or replace function public.quiz_assignment_restart(p_assignment_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.quiz_assignments;
begin
  if p_assignment_id is null or p_assignment_id = '' then raise exception 'invalid_argument'; end if;
  select * into a from public.quiz_assignments x
   where x.id = p_assignment_id and x.user_id = auth.uid() and x.unit_id = public.auth_unit_id()
     and x.sent_at is not null
   for update;
  if not found or a.completed_at is not null then return false; end if;
  if a.count_from is null or a.count_from >= a.sent_at then return false; end if;
  update public.quiz_assignments set count_from = now() where id = a.id;
  return true;
end $$;
revoke all on function public.quiz_assignment_restart(text) from public, anon;
grant execute on function public.quiz_assignment_restart(text) to authenticated;

-- ── 예약 발송 (베이스 = 0332 본문 통째 · ⓓ 한 줄을 더했다) ──
create or replace function public.due_quiz_sends()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql
security definer
set search_path = public
as $$
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
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       -- ★0327: 낼 문항이 없는 퀴즈는 보내지 않는다(되살리면 다시 나간다). 0248 의 "담긴 노하우가 전부 보관" 도 여기 들어간다.
       --   후보에서 빼야 한다. 뽑힌 뒤 claim 에서 거르면 그 사람의 다른 퀴즈가 이 행에 막혀 매 스윕 밀린다.
       -- ★0332: 보관·본사 숨김도 servable 안의 quiz_course_live 가 본다. 0327 의 코스 활성 줄은 여기로 합쳤다.
       and exists (select 1 from public.quiz_course_servable(qa.unit_id, qa.course_id))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
       -- ★0348 ⓓ: 다시 알리기(manual) 대기 행은 그 행이 생긴 뒤 같은 (퀴즈, 사람)이 완료했으면 보내지 않는다.
       --   후보에서 빼야 한다(위 0327 과 같은 이유). 행은 지우지 않는다. 화면은 나간 발송을 먼저 본다(progress.currentSend).
       --   재확인(recheck)은 빼지 않는다. 노하우가 바뀌어 완료자도 다시 풀어야 한다.
       and not (qa.origin = 'manual' and exists (
         select 1 from public.quiz_assignments d
          where d.unit_id = qa.unit_id and d.course_id = qa.course_id and d.user_id = qa.user_id
            and d.completed_at is not null and d.completed_at >= qa.created_at
       ))
     order by qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    --    ★0242: 이미 끝난 반복 행(valid_to < 오늘 · 지난 구간 복사본)은 "근무표를 쓴다"로 세지 않는다.
    --           안 빼면 근무표를 그만 쓴 매장은 퀴즈가 영원히 0건이 된다.
    --    ★0301: 판정은 unit_uses_schedule 하나(할일 알림과 같음). 지난 하루 근무·옛 재직분 근무는 세지 않는다.
    if public.unit_uses_schedule(a.unit_id, v_date) then
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
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant execute on function public.due_quiz_sends() to service_role;

-- ── 자가점검 ──
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_quiz_assignment_carry_count_from' and tgrelid = 'public.quiz_assignments'::regclass) then
    raise exception '0348: 집계 시작 시각 트리거가 없다';
  end if;
  if position('quiz_assignment_count_from' in pg_get_functiondef('public.quiz_assignment_pending(text)'::regprocedure)) = 0
     or position('quiz_assignment_count_from' in pg_get_functiondef('public.quiz_assignment_state(text)'::regprocedure)) = 0 then
    raise exception '0348: 진행·상태가 집계 시작 시각을 안 본다';
  end if;
  if has_function_privilege('anon', 'public.quiz_assignment_restart(text)', 'execute') then
    raise exception '0348: anon 이 다시 풀기를 부를 수 있다';
  end if;
end $$;
