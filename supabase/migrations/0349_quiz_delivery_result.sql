-- 0349 퀴즈 발송 결과 기록 + 1회 재배달 (2026-11-05 · 업계 표준 대비 감사 M2-1 · 계획 = 산출물/업계표준대비_2026-11-04/계획_M2_선점뒤발송.md D1)
-- 옛 앱 호환: 안전 | 테이블은 nullable 열 2개 추가만(delivered · suppressed · 모름=null · 0174 규약).
--   옛 클라(main 웹 · 출시 iOS·안드)는 quiz_assignments 를 열 목록으로만 읽는다(db.ts:3221 QUIZ_ASSIGNMENT_COLS · select('*') 없음 ·
--   db.ts:3242/3269/3290/3345). 옛 앱의 다시 알리기 upsert 는 새 열을 안 쓰므로 null(=모름=알림으로 센다)이다.
--   due_quiz_sends · claim_quiz_send 는 push 엣지만 부른다(supabase/functions/push/index.ts:466·477). 이름·인자·반환 열 그대로.
--   claim_quiz_push_retry 는 새 함수다. 새 엣지만 부르고, 옛 엣지 + 새 DB 는 delivered 를 안 적어 null 로 남는다 → 옛 동작(알림으로 셈) 그대로.
--   옛 DB + 새 엣지: 함수 없음 → 엣지가 로그 후 건너뛴다(계약 §엣지).
--
-- 무엇이 어긋났나(계층 · 규칙)
--   퀴즈 발송은 claim_quiz_send 가 sent_at 을 찍는 순간 "나간 것"이 됐다. 푸시가 실제로 접수됐는지는 어디에도 안 남았다.
--   그래서 ① 엣지가 죽어 푸시가 안 간 발송도 자동 정지(④ 연속 2회 무시)의 "무시"로 셌고 ② 못 간 발송을 다시 보낼 길이 없었다.
--   ★sent_at 은 "푸시 선점"이 아니라 발급이다. 인앱 노출·due_on·count_from 트리거·mark_quiz_opened/completed 가 전부 sent_at 에 걸려 있어
--     선점을 deliver 뒤로 옮기면 푸시 실패 때 퀴즈가 앱에서도 안 보인다. 그래서 sent_at 은 그대로 두고 결과만 따로 적는다.
--
-- 고친 것
--   ⓐ 결과 열 = delivered(Expo 접수 수 · 영수증 아님) · suppressed(개인 설정·음소거로 억제된 수). 엣지가 deliver 뒤 service_role 로 update 한다(새 RPC 없음).
--   ⓑ "알린 것으로 보나" SSOT = quiz_send_notified(행) = coalesce(delivered,1) > 0 or coalesce(suppressed,0) > 0.
--      null = 옛 엣지·미기록 = 알림으로 센다(옛 동작 보존). 억제(suppressed)도 알림으로 센다(사용자 결정 M2-2 · 인앱 알림함은 남는다는 약속과 같은 축.
--      아니면 알림을 끈 사람은 영원히 자동 정지되지 않는다).
--   ⓒ due_quiz_sends ④ 자동 정지만 이 함수를 본다. 못 간 발송은 "무시"가 아니다. 하루 1회·7일 2회는 sent_at(발급) 기준 그대로다
--      (사용자 결정 M2-1 · delivered 기준으로 바꾸면 푸시만 실패한 사람에게 같은 날 2번째 퀴즈가 인앱에 쌓이고 (course,user,scheduled_on) 유일 제약과 어긋난다).
--   ⓓ 실패분은 claim_quiz_push_retry() = sent_at 10분~1시간 전 · delivered null · 안 열고 안 끝낸 행을 delivered=0 으로 찍으며 돌려준다 = 재배달 1회.
--      엣지가 보낸 직후 기록 전에 죽으면 1회 중복 푸시가 날 수 있다. 유실보다 중복(사용자 결정 M2-3).
--      수신자 술어는 due_quiz_sends 와 같은 헬퍼(unit_access_locked · quiz_recipient_is_member · seat_locked_for)를 부른다 — 나간 직원·잠긴 좌석·닫힌 매장엔 재배달하지 않는다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): due_quiz_sends 0348:345 → 0349. 새: quiz_send_notified · claim_quiz_push_retry.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 결과 열 ──
alter table public.quiz_assignments
  add column if not exists delivered  int,
  add column if not exists suppressed int;
comment on column public.quiz_assignments.delivered is
  '이 발송의 푸시가 접수된 수(0349). Expo 접수 기준(영수증 아님) · null=옛 엣지/미기록. 재배달(claim_quiz_push_retry)·재선점은 0 으로 찍는다.';
comment on column public.quiz_assignments.suppressed is
  '이 발송에서 개인 설정(알림 끔·방해금지·음소거)으로 억제된 수(0349). Expo 접수 기준(영수증 아님) · null=옛 엣지/미기록.';

-- ── ⓑ 알린 것으로 보나 (한 곳) ──
-- 읽는 곳은 due_quiz_sends ④ 하나다. 하니스(qa-quiz-schedule Q2~Q4)가 진리표를 잰다.
create or replace function public.quiz_send_notified(a public.quiz_assignments)
returns boolean language sql immutable as $$
  select coalesce(a.delivered, 1) > 0 or coalesce(a.suppressed, 0) > 0
$$;
revoke all on function public.quiz_send_notified(public.quiz_assignments) from public, anon, authenticated;
grant execute on function public.quiz_send_notified(public.quiz_assignments) to service_role;

-- ── ⓒ 예약 발송 (베이스 = 0348:345 본문 통째 · ④ 루프에 quiz_send_notified 한 줄) ──
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
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name, qa.resend_at
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       -- ★0348 ⓔ: 사장이 지금 보내라고 한 행(resend_at)은 예약일과 무관하게 후보다.
       and (qa.scheduled_on <= v_date or qa.resend_at is not null)
       -- ★0327: 낼 문항이 없는 퀴즈는 보내지 않는다(되살리면 다시 나간다). 0248 의 "담긴 노하우가 전부 보관" 도 여기 들어간다.
       --   후보에서 빼야 한다. 뽑힌 뒤 claim 에서 거르면 그 사람의 다른 퀴즈가 이 행에 막혀 매 스윕 밀린다.
       -- ★0332: 보관·본사 숨김도 servable 안의 quiz_course_live 가 본다. 0327 의 코스 활성 줄은 여기로 합쳤다.
       and exists (select 1 from public.quiz_course_servable(qa.unit_id, qa.course_id))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       -- ★0348: 판정은 quiz_recipient_is_member 하나다(quiz_resend 의 not_member 와 같음 · 11-04 사용자 "나간 직원은 대상에서 빠진다").
       and public.quiz_recipient_is_member(qa.unit_id, qa.user_id)
       -- ★0348 ⓓ·ⓗ(2026-11-04 사용자 결정): 그 퀴즈를 다 푼 사람에게는 어떤 행도 보내지 않는다.
       --   manual(다시 알리기 resend_at 포함) · join · recheck 전부다. 판정은 quiz_course_done_by 하나다(quiz_resend 와 같음).
       --   후보에서 빼야 한다(위 0327 과 같은 이유). 이 줄은 행을 지우지 않는다. manual 대기 행은 ⓖ 가 완료 순간 지운다.
       --   ★바뀐 것: 11-03 판에서는 재확인을 이 거르기에서 뺐고(노하우가 바뀌면 완료자도 다시 푼다),
       --     완료 뒤 다시 알리기(resend_at)는 그 시각부터 봤다. 11-04 사용자 결정으로 둘 다 막는다.
       and not public.quiz_course_done_by(qa.unit_id, qa.course_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 7번): 무료 인원 한도를 넘어 잠긴 직원에게는 보내지 않는다. 판정 = seat_locked_for(0336) 하나.
       --   행은 남는다. 매장이 다시 유료가 되거나 사장이 그 사람을 남길 명단에 넣으면 그때 나간다.
       and not public.seat_locked_for(qa.unit_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 9번): 사장이 고른 마감(due_date)이 이미 지난 대기 행은 보내지 않는다.
       --   보내면 claim_quiz_send 가 due_on 을 그 지난 날짜로 찍어, 받자마자 마감이 지난 퀴즈가 된다.
       --   다시 알리기(quiz_resend)는 지난 마감을 비우고 보낸다. due_date 없는 행은 받은 날 + answer_days 라 지날 수 없다.
       and (qa.due_date is null or qa.due_date >= v_date)
     -- ★0348 ⓔ: 지금 보내라고 한 행이 먼저다(한 스윕에 한 사람 1건 · v_taken).
     order by (qa.resend_at is null), qa.scheduled_on, qa.created_at
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
    --    ★0348 ⓔ: 사장이 지금 보내라고 한 행(resend_at)은 ①②④ 를 건너뛴다. ③ 7일 상한은 지킨다.
    if a.resend_at is null and public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if a.resend_at is null and exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창). ★0348: 판정은 quiz_week_sends_full 하나(quiz_resend 와 같이 쓴다).
    if public.quiz_week_sends_full(a.unit_id, a.user_id) then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      -- ★0348 ⓔ: 지금 보내라고 한 행은 자동 정지를 건너뛴다(아래 루프가 0건).
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         -- ★0349 ⓒ: 푸시가 안 간 발송(delivered=0 · suppressed 0/null)은 "무시"로 세지 않는다. 판정 = quiz_send_notified 하나.
         --   null(옛 엣지·미기록)은 알림으로 센다. 억제(suppressed)도 알림으로 센다(사용자 결정 M2-2).
         and public.quiz_send_notified(x)
         and a.resend_at is null
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

-- ── ⓓ 재배달 1회 (service_role 전용 · push 엣지 sweepQuizSends 의 두 번째 패스가 부른다) ──
-- 반환 모양 = due_quiz_sends 와 같다(엣지가 같은 deliver 경로를 탄다).
-- 조건: 나간 지 10분~1시간(10분 안은 엣지가 아직 적는 중일 수 있다 · 1시간 넘으면 묵은 알림을 몰아 보내지 않는다 · sweep_* 의 1일 규칙과 같은 취지)
--   · delivered null(결과를 못 적음) · 안 열고 안 끝냄(이미 본 사람에게 다시 울리지 않는다).
-- 같은 update 에서 delivered=0 을 찍으므로 두 번째 호출은 0건이다(=재배달은 1회). 엣지는 보낸 뒤 실제 수로 덮어쓴다.
-- 수신자 술어 = due_quiz_sends 후보 거르기와 같은 헬퍼(복제 금지): 삭제·잠긴 매장(units.deleted_at · unit_access_locked) ·
--   나간 직원(quiz_recipient_is_member · 0348 "나간 직원은 대상에서 빠진다") · 잠긴 좌석(seat_locked_for). 대상이 아닌 행은 잡지 않고 null 로 남긴다(기록 유지).
create or replace function public.claim_quiz_push_retry()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
    with c as (
      update public.quiz_assignments a
         set delivered = 0
       where a.id in (select x.id from public.quiz_assignments x
                       -- ★0349: 매장·사람 술어는 due_quiz_sends 와 같은 헬퍼를 쓴다.
                       join public.units u on u.id = x.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
                       where x.sent_at between now() - interval '1 hour' and now() - interval '10 minutes'
                         and x.delivered is null and x.opened_at is null and x.completed_at is null
                         and public.quiz_recipient_is_member(x.unit_id, x.user_id)
                         and not public.seat_locked_for(x.unit_id, x.user_id)
                       order by x.sent_at
                       limit 200
                       for update skip locked)
      returning a.id, a.unit_id, a.user_id, a.course_id
    )
    select c.id, c.unit_id, c.user_id::text, t.name
      from c
      join public.training_courses t on t.id = c.course_id
     order by c.id;
end $$;
revoke all on function public.claim_quiz_push_retry() from public, anon, authenticated;
grant execute on function public.claim_quiz_push_retry() to service_role;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare
  f text := 'public.quiz_send_notified(public.quiz_assignments)';
  mk constant text := 'select public.quiz_send_notified(jsonb_populate_record(null::public.quiz_assignments, $1::jsonb))';
  v boolean;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'quiz_assignments' and column_name in ('delivered', 'suppressed')) <> 2 then
    raise exception '0349 자가점검 실패 — delivered · suppressed 열이 없다';
  end if;
  -- 진리표: null/null=t · 1/0=t · 0/1=t · 0/0=f · 0/null=f
  execute mk into v using '{}';                               if not v then raise exception '0349 자가점검 실패 — null/null 은 알림이어야 한다'; end if;
  execute mk into v using '{"delivered":1,"suppressed":0}';   if not v then raise exception '0349 자가점검 실패 — 1/0 은 알림이어야 한다'; end if;
  execute mk into v using '{"delivered":0,"suppressed":1}';   if not v then raise exception '0349 자가점검 실패 — 0/1 은 알림이어야 한다'; end if;
  execute mk into v using '{"delivered":0,"suppressed":0}';   if v then raise exception '0349 자가점검 실패 — 0/0 은 알림이 아니어야 한다'; end if;
  execute mk into v using '{"delivered":0}';                  if v then raise exception '0349 자가점검 실패 — 0/null 은 알림이 아니어야 한다'; end if;
  if position('quiz_send_notified' in pg_get_functiondef('public.due_quiz_sends()'::regprocedure)) = 0 then
    raise exception '0349 자가점검 실패 — due_quiz_sends ④ 가 quiz_send_notified 를 안 본다';
  end if;
  if pg_get_function_result('public.claim_quiz_push_retry()'::regprocedure)
     is distinct from pg_get_function_result('public.due_quiz_sends()'::regprocedure) then
    raise exception '0349 자가점검 실패 — claim_quiz_push_retry 반환 모양이 due_quiz_sends 와 다르다';
  end if;
  if has_function_privilege('authenticated', 'public.claim_quiz_push_retry()', 'execute')
     or has_function_privilege('anon', 'public.claim_quiz_push_retry()', 'execute')
     or has_function_privilege('authenticated', f, 'execute') then
    raise exception '0349 자가점검 실패 — 발송 함수가 클라에 열렸다';
  end if;
  raise notice '0349 자가점검 통과';
end $$;
