-- rollback/0930.sql — due_quiz_sends 를 0349 본문으로 되돌리고 quiz_send_now 를 지운다("지금 바로" = 다시 지금 규칙 + 다음 스윕).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0930.sql --linked
-- send_now 열은 남긴다. 새 앱이 QUIZ_ASSIGNMENT_COLS 로 읽으므로 지우면 새 앱의 퀴즈 원장 읽기가 깨진다(확장 → 축소 · ⑪).
-- 순서: 새 앱이 quiz_send_now 를 부르면 함수 없음 오류가 난다. 새 앱(웹)을 먼저 내리거나, 호출부가 오류를 일반 문구로 떨어뜨리는지 본다.
begin;
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

drop function if exists public.quiz_send_now(text);
commit;
