-- 0930 퀴즈 "지금 바로" 즉시 발송 (2026-11-19 · 첫 사용 수정 B1 · 정본 = 산출물/첫사용측정_2026-11-17/세션A_첫사용수정_멀티에이전트_2026-11-19.md B1)
-- 옛 앱 호환: 안전 | 확장만 한다.
--   열 하나(send_now · not null default false)를 더한다. 옛 앱·옛 웹은 이 열을 모르고 행을 넣는다 → false → 지금 규칙 + 다음 스윕(5분 크론).
--   옛 클라는 quiz_assignments 를 열 목록으로만 읽는다(QUIZ_ASSIGNMENT_COLS · select('*') 없음). 옛 앱 upsert 도 이 열을 안 쓴다.
--   due_quiz_sends · claim_quiz_send 는 push 엣지만 부른다. 이름·인자·반환 열 그대로라 엣지를 바꾸지 않는다.
--   quiz_send_now 는 새 RPC 다. 새 앱만 부른다.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   사장이 퀴즈를 만들며 "지금 바로"를 고르면 앱은 오늘 날짜(scheduled_on)로 행을 넣고 끝났다. 서버에는 "지금"이라는 뜻이 없었다.
--   그래서 due_quiz_sends 가 예약 발송과 같은 규칙(① 근무 중 · ② 하루 1회 · ③ 7일 2회)으로 막았고,
--   근무 밖 직원 · 오늘 이미 받은 직원에게는 "지금 바로"가 몇 시간~며칠 뒤에 나갔다(첫 사용 측정 2026-11-17).
--
-- 고친 것
--   ⓐ 열 send_now = 사장이 "지금 바로"라고 한 행. quiz_send_now 만 세운다(사장은 qz_update 로 직접 쓸 수도 있지만 관리 권한이라 RPC 와 같은 힘이다).
--   ⓑ due_quiz_sends(베이스 = 0349 본문 통째): send_now 행은 ① 근무 시간(근무표 매장 · 근무 밖 · 오늘 근무 없음) · ② 하루 1회 · ③ 7일 2회를 건너뛴다.
--      판정은 이 함수 한 곳이다(2026-11-19 사용자 결정).
--      그대로 지키는 것 = 후보 거르기 전부(다 푼 사람 · 나간 직원 · 좌석 잠김 · 매장 잠김·삭제 · 마감 지남 · 낼 문항 0개) + ④ 연속 2회 무시 자동 정지.
--      ★resend_at(0348 다시 알리기)과 다르다: 다시 알리기는 ①②④ 를 건너뛰고 ③ 을 지킨다. 지금 바로는 ①②③ 을 건너뛰고 ④ 를 지킨다.
--        예약 발송 · 다시 알리기 · 재확인 퀴즈는 지금 규칙 그대로다(가정 · 사용자 확인 전).
--   ⓒ quiz_send_now(p_course_id): 사장·매니저만. 호출자 활성 매장의 그 퀴즈 행 중 sent_at null · scheduled_on <= 매장 오늘(KST) 행에 표시를 세우고
--      스윕을 한 번 앞당긴다(quiz_kick_send_sweep · 0351 · 다시 알리기와 같은 길). 반환 = 호출 뒤 표시가 있고 아직 안 나간 행 수.
--      두 번 불러도 한 번만 간다: 행을 새로 만들지 않고(표시 update 는 멱등) 실제 발송 선점은 claim_quiz_send 의 sent_at is null 조건부 update 다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): due_quiz_sends 0349:49 → 0930. 새: quiz_send_now.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 되돌리기 = scripts/rollback/0930.sql (열은 남긴다 · 새 앱이 읽는다).
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 표시 열 ──
alter table public.quiz_assignments
  add column if not exists send_now boolean not null default false;
comment on column public.quiz_assignments.send_now is
  '사장이 "지금 바로" 보내라고 한 행(0930). quiz_send_now 가 세운다. true 면 due_quiz_sends 가 근무 시간·하루 1회·7일 2회를 건너뛴다.
   다 푼 사람·나간 직원·좌석 잠김·마감 지남·문항 0개·연속 무시 자동 정지는 그대로 지킨다. 옛 앱이 넣은 행은 false(지금 규칙).';

-- ── ⓑ 예약 발송 (베이스 = 0349:49 본문 통째 · send_now 네 줄) ──
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
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name, qa.resend_at, qa.send_now
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       -- ★0348 ⓔ: 사장이 지금 보내라고 한 행(resend_at)은 예약일과 무관하게 후보다.
       --   ★0930: send_now 행은 quiz_send_now 가 오늘 이하 행에만 세우므로 이 줄을 바꾸지 않는다.
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
       --   ★0930: send_now 행도 여기서 빠진다(지금 바로여도 다 푼 사람에게는 안 간다).
       and not public.quiz_course_done_by(qa.unit_id, qa.course_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 7번): 무료 인원 한도를 넘어 잠긴 직원에게는 보내지 않는다. 판정 = seat_locked_for(0336) 하나.
       --   행은 남는다. 매장이 다시 유료가 되거나 사장이 그 사람을 남길 명단에 넣으면 그때 나간다.
       and not public.seat_locked_for(qa.unit_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 9번): 사장이 고른 마감(due_date)이 이미 지난 대기 행은 보내지 않는다.
       --   보내면 claim_quiz_send 가 due_on 을 그 지난 날짜로 찍어, 받자마자 마감이 지난 퀴즈가 된다.
       --   다시 알리기(quiz_resend)는 지난 마감을 비우고 보낸다. due_date 없는 행은 받은 날 + answer_days 라 지날 수 없다.
       and (qa.due_date is null or qa.due_date >= v_date)
     -- ★0348 ⓔ: 지금 보내라고 한 행이 먼저다(한 스윕에 한 사람 1건 · v_taken). ★0930: send_now 행도 같은 앞줄이다.
     order by (qa.resend_at is null and not qa.send_now), qa.scheduled_on, qa.created_at
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
    --    ★0930: "지금 바로"(send_now) 행은 ①②③ 을 건너뛴다. ④ 자동 정지는 지킨다(2026-11-19 사용자 결정).
    if a.resend_at is null and not a.send_now and public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다. ★0930: send_now 는 건너뛴다.
    if a.resend_at is null and not a.send_now and exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창). ★0348: 판정은 quiz_week_sends_full 하나(quiz_resend 와 같이 쓴다).
    --    ★0930: send_now 는 건너뛴다. 지금 바로로 나간 발송도 sent_at 이 있으니 다음 예약 발송의 ②③ 에는 센다.
    if not a.send_now and public.quiz_week_sends_full(a.unit_id, a.user_id) then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    --    ★0930: send_now 행도 이 판정을 그대로 받는다(지금대로 · 2026-11-19 사용자 결정).
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

-- ── ⓒ 지금 바로 (새 RPC · 새 앱만 부른다 · 관리 권한) ──
-- 인자: 퀴즈 id(training_courses.id 는 text 다 · quiz_resend 와 같은 모양).
-- 대상 = 호출자 활성 매장의 그 퀴즈 행 중 sent_at null · scheduled_on <= 매장 오늘(KST). 미래 날짜 예약 행은 건드리지 않는다.
-- 반환 = 호출 뒤 그 퀴즈의 send_now=true · sent_at null 행 수(다 푼 사람·나간 직원 행도 센다. 그 행은 due_quiz_sends 가 거른다).
-- 오류 = invalid_argument(빈 인자) · forbidden(매장 없음·관리 권한 없음) · quiz_not_found(이 매장 퀴즈 아님) · quiz_no_items(낼 문항 0개 · 0327 과 같은 코드).
-- RLS 를 우회하는 정의자 함수라 매장·권한을 여기서 본다(quiz_resend 와 같은 판정 · 0348).
create or replace function public.quiz_send_now(p_course_id text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text := public.auth_unit_id();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_n     int;
begin
  if p_course_id is null or p_course_id = '' then raise exception 'invalid_argument'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.training_courses c where c.id = p_course_id and c.unit_id = v_unit) then
    raise exception 'quiz_not_found';
  end if;
  if not exists (select 1 from public.quiz_course_servable(v_unit, p_course_id)) then raise exception 'quiz_no_items'; end if;

  -- race: 표시 update 는 멱등이고 행을 새로 만들지 않는다. 두 번 불러도 행 수·표시가 같다.
  --   실제 발송의 한 번은 claim_quiz_send 의 조건부 update(sent_at is null)가 지킨다. 스윕을 두 번 앞당겨도 두 번째 선점은 0행이다.
  update public.quiz_assignments a
     set send_now = true
   where a.unit_id = v_unit and a.course_id = p_course_id
     and a.sent_at is null and a.scheduled_on <= v_today and not a.send_now
     -- 사장이 보낸 행만. 합류(join)·재확인(recheck) 대기 행은 지금 규칙(근무·하루·주)을 그대로 따른다(2026-11-19 가정).
     and a.origin = 'manual';

  select count(*)::int into v_n from public.quiz_assignments a
   where a.unit_id = v_unit and a.course_id = p_course_id and a.send_now and a.sent_at is null;

  if v_n > 0 then perform public.quiz_kick_send_sweep(); end if;
  return v_n;
end $$;
revoke all on function public.quiz_send_now(text) from public, anon;
grant execute on function public.quiz_send_now(text) to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare d text := pg_get_functiondef('public.due_quiz_sends()'::regprocedure);
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'quiz_assignments' and column_name = 'send_now'
                    and is_nullable = 'NO' and data_type = 'boolean' and column_default = 'false') then
    raise exception '0930 자가점검 실패 — send_now 열이 boolean not null default false 가 아니다';
  end if;
  -- ①②③ 세 자리와 정렬 한 자리 = send_now 네 번 이상 · ④ 와 0349 판정은 남아 있어야 한다.
  if (length(d) - length(replace(d, 'not a.send_now', ''))) / length('not a.send_now') < 3 then
    raise exception '0930 자가점검 실패 — due_quiz_sends ①②③ 가 send_now 를 안 본다';
  end if;
  if position('quiz_send_notified' in d) = 0 or position('quiz_course_done_by' in d) = 0
     or position('quiz_recipient_is_member' in d) = 0 or position('seat_locked_for' in d) = 0 then
    raise exception '0930 자가점검 실패 — due_quiz_sends 가 0349 의 거르기·자동 정지를 잃었다';
  end if;
  if pg_get_function_result('public.quiz_send_now(text)'::regprocedure) <> 'integer' then
    raise exception '0930 자가점검 실패 — quiz_send_now 반환이 integer 가 아니다';
  end if;
  if not has_function_privilege('authenticated', 'public.quiz_send_now(text)', 'execute')
     or has_function_privilege('anon', 'public.quiz_send_now(text)', 'execute') then
    raise exception '0930 자가점검 실패 — quiz_send_now 권한(authenticated 만)';
  end if;
  if has_function_privilege('authenticated', 'public.due_quiz_sends()', 'execute')
     or has_function_privilege('authenticated', 'public.quiz_kick_send_sweep()', 'execute') then
    raise exception '0930 자가점검 실패 — 발송 함수가 클라에 열렸다';
  end if;
  raise notice '0930 자가점검 통과';
end $$;
