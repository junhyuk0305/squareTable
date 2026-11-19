-- rollback/0871.sql — 0871 이전 판정으로 되돌린다(근무 시간 · 하루 1회 · 7일 2회 · 자동 정지 · 한 스윕 1건 · 재확인 큐 · 쿨다운 10분).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0871.sql --linked
-- 본문은 직전 정본 파일에서 그대로 옮겼다: due_quiz_sends·quiz_send_now = 0870 · quiz_send_status = 0301 · recipient_readiness = 0312 · quiz_resend·quiz_resend_cooldown = 0348.
-- send_at 열은 남긴다(새 앱이 넣는다 · 지우면 새 앱 insert 가 깨진다 · ⑪). 남은 send_at 은 옛 판정이 보지 않는다(예약일·근무 시간 규칙으로 나간다).
-- 0871 ⓖ 로 지운 안 나간 재확인 행은 되살리지 않는다. 되돌린 due_quiz_sends 가 다음 스윕에 재확인 큐를 다시 채운다.
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
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name, qa.resend_at, qa.send_now
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       -- ★0348 ⓔ: 사장이 지금 보내라고 한 행(resend_at)은 예약일과 무관하게 후보다.
       --   ★0870: send_now 행은 quiz_send_now 가 오늘 이하 행에만 세우므로 이 줄을 바꾸지 않는다.
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
       --   ★0870: send_now 행도 여기서 빠진다(지금 바로여도 다 푼 사람에게는 안 간다).
       and not public.quiz_course_done_by(qa.unit_id, qa.course_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 7번): 무료 인원 한도를 넘어 잠긴 직원에게는 보내지 않는다. 판정 = seat_locked_for(0336) 하나.
       --   행은 남는다. 매장이 다시 유료가 되거나 사장이 그 사람을 남길 명단에 넣으면 그때 나간다.
       and not public.seat_locked_for(qa.unit_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 9번): 사장이 고른 마감(due_date)이 이미 지난 대기 행은 보내지 않는다.
       --   보내면 claim_quiz_send 가 due_on 을 그 지난 날짜로 찍어, 받자마자 마감이 지난 퀴즈가 된다.
       --   다시 알리기(quiz_resend)는 지난 마감을 비우고 보낸다. due_date 없는 행은 받은 날 + answer_days 라 지날 수 없다.
       and (qa.due_date is null or qa.due_date >= v_date)
     -- ★0348 ⓔ: 지금 보내라고 한 행이 먼저다(한 스윕에 한 사람 1건 · v_taken). ★0870: send_now 행도 같은 앞줄이다.
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
    --    ★0870: "지금 바로"(send_now) 행은 ①②③ 을 건너뛴다. ④ 자동 정지는 지킨다(2026-11-19 사용자 결정).
    if a.resend_at is null and not a.send_now and public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다. ★0870: send_now 는 건너뛴다.
    if a.resend_at is null and not a.send_now and exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창). ★0348: 판정은 quiz_week_sends_full 하나(quiz_resend 와 같이 쓴다).
    --    ★0870: send_now 는 건너뛴다. 지금 바로로 나간 발송도 sent_at 이 있으니 다음 예약 발송의 ②③ 에는 센다.
    if not a.send_now and public.quiz_week_sends_full(a.unit_id, a.user_id) then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    --    ★0870: send_now 행도 이 판정을 그대로 받는다(지금대로 · 2026-11-19 사용자 결정).
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

create or replace function public.quiz_send_status(p_course_id text)
returns table(user_id uuid, reason text)
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_date   date := (now() at time zone 'Asia/Seoul')::date;
  v_unit   text;
  a        record;
  h        record;
  v_streak int;
begin
  if not public.auth_can_manage() then return; end if;
  select c.unit_id into v_unit
    from public.training_courses c
   where c.id = p_course_id and c.unit_id = public.auth_unit_id();
  if v_unit is null then return; end if;

  for a in
    select distinct qa.user_id
      from public.quiz_assignments qa
     where qa.course_id = p_course_id
       and qa.sent_at is null
       and qa.scheduled_on <= v_date
       and exists (select 1 from public.unit_members m where m.unit_id = qa.unit_id and m.user_id = qa.user_id)
  loop
    -- ① 근무표를 쓰는 매장(0242 조건)인데 이 사람의 오늘 이후 근무가 없다.
    if public.unit_uses_schedule(v_unit, v_date)   -- ★0301: due_quiz_sends 와 같은 판정 함수
       and not exists (select 1 from public.shift_templates st
                        where st.unit_id = v_unit
                          and st.staff_id = a.user_id::text
                          and st.archived_tenure_id is null
                          and (st.shift_date >= v_date
                               or (st.shift_date is null and (st.valid_to is null or st.valid_to >= v_date)))) then
      user_id := a.user_id; reason := 'not_scheduled';
      return next;
      continue;
    end if;

    -- ② 연속 2회 무시(due_quiz_sends ④ 와 같은 셈).
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = v_unit and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then
      user_id := a.user_id; reason := 'auto_stopped';
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.quiz_send_status(text) from public, anon, authenticated;
grant  execute on function public.quiz_send_status(text) to authenticated;

create or replace function public.recipient_readiness(p_unit_id text, p_user_ids uuid[])
returns table (
  user_id           uuid,
  has_device        boolean,
  push_on           boolean,
  on_schedule       boolean,
  blocked_reason    text,
  weekly_quota_left int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date;
  v_uses boolean;
  u      uuid;
begin
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = auth.uid()
       and m.unit_id = p_unit_id
       and m.role in ('owner', 'manager')
  )
  -- ★0312 (나): 그 매장 멤버가 그 매장의 사장·매니저만 묻는 경우는 허용(직원 → "사장님이 앱을 열 때 보실 거예요").
  and not (
    exists (select 1 from public.unit_members m
             where m.user_id = auth.uid() and m.unit_id = p_unit_id)
    and coalesce(array_length(p_user_ids, 1), 0) > 0
    and not exists (
      select 1 from unnest(p_user_ids) as t(uid)
       where not exists (select 1 from public.unit_members m
                          where m.unit_id = p_unit_id and m.user_id = t.uid
                            and m.role in ('owner', 'manager')))
  ) then
    raise exception 'not_owner';
  end if;

  v_uses := public.unit_uses_schedule(p_unit_id, v_date);

  for u in
    select distinct m.user_id
      from public.unit_members m
     where m.unit_id = p_unit_id
       and m.user_id = any(p_user_ids)
  loop
    user_id := u;

    has_device := exists (select 1 from public.push_device_targets(array[u]))
               or exists (select 1 from public.push_web_targets(array[u]));

    push_on := coalesce(
      (select p.push_enabled from public.notification_prefs p where p.user_id = u),
      true);

    -- quiz_send_status(0301) ① 의 부정. 근무표를 쓰는 매장인데 이 사람의 오늘 이후 근무가 없으면 false.
    on_schedule := (not v_uses) or exists (
      select 1 from public.shift_templates st
       where st.unit_id = p_unit_id
         and st.staff_id = u::text
         and st.archived_tenure_id is null
         and (st.shift_date >= v_date
              or (st.shift_date is null and (st.valid_to is null or st.valid_to >= v_date))));

    -- due_quiz_sends ③ 과 같은 셈(7일 슬라이딩 창 · 2건).
    weekly_quota_left := greatest(0, 2 - (
      select count(*)::int from public.quiz_assignments x
       where x.unit_id = p_unit_id and x.user_id = u
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'));

    blocked_reason := case
      when not has_device  then 'no_device'
      when not push_on     then 'push_off'
      when not on_schedule then 'not_scheduled'
      else null
    end;

    return next;
  end loop;
end $$;

revoke all on function public.recipient_readiness(text, uuid[]) from public, anon, authenticated;
grant  execute on function public.recipient_readiness(text, uuid[]) to authenticated;

create or replace function public.quiz_resend_cooldown()
returns interval language sql immutable as $$ select interval '10 minutes' $$;
revoke all on function public.quiz_resend_cooldown() from public, anon, authenticated;

create or replace function public.quiz_resend(p_course_id text, p_user_ids uuid[])
returns table(user_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text := public.auth_unit_id();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_due   date;
  v_uid   uuid;
  v_last  timestamptz;
  v_row   public.quiz_assignments;
  v_on    date;
  v_total int := 0;
  v_cool  int := 0;
  v_kick  boolean := false;
begin
  if p_course_id is null or p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 200 then
    raise exception 'invalid_argument';
  end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.training_courses c where c.id = p_course_id and c.unit_id = v_unit) then
    raise exception 'quiz_not_found';
  end if;
  if not exists (select 1 from public.quiz_course_servable(v_unit, p_course_id)) then raise exception 'quiz_no_items'; end if;
  select a.due_date into v_due from public.quiz_assignments a
   where a.unit_id = v_unit and a.course_id = p_course_id and a.due_date is not null
   order by a.created_at desc limit 1;

  for v_uid in select distinct u from unnest(p_user_ids) u where u is not null loop
    v_total := v_total + 1;
    perform pg_advisory_xact_lock(hashtext('quiz_resend:' || p_course_id || ':' || v_uid::text));
    user_id := v_uid;
    if not public.quiz_recipient_is_member(v_unit, v_uid) then
      result := 'not_member'; return next; continue;
    end if;
    -- 무료 인원 한도를 넘어 잠긴 직원(정본 seat_locked_for · 0336)은 받지 않는다. due_quiz_sends 와 같은 판정이다(오류 탐지 11-03 7번).
    if public.seat_locked_for(v_unit, v_uid) then
      result := 'locked'; return next; continue;
    end if;
    -- ⓗ 그 퀴즈를 다 푼 사람은 다시 받지 않는다(2026-11-04 사용자 결정). 행을 만들지도 고치지도 않는다.
    if public.quiz_course_done_by(v_unit, p_course_id, v_uid) then
      result := 'completed'; return next; continue;
    end if;
    -- 쿨다운 기준 = 마지막 다시 알리기 요청(resend_at) 하나. 일반 발송(첫 발송·크론)은 세지 않는다(사용자 결정: "다시 알리기를 한 번 보내면 10분").
    select max(x.resend_at) into v_last from public.quiz_assignments x
     where x.unit_id = v_unit and x.course_id = p_course_id and x.user_id = v_uid;
    if v_last is not null and v_last > now() - public.quiz_resend_cooldown() then
      v_cool := v_cool + 1; result := 'cooldown'; return next; continue;
    end if;

    select * into v_row from public.quiz_assignments x
     where x.unit_id = v_unit and x.course_id = p_course_id and x.user_id = v_uid
       and x.sent_at is null and x.origin = 'manual'
     order by x.scheduled_on limit 1 for update;
    if found then
      -- 마감(0291 due_date)이 이미 지났으면 비운다. 새 행의 "마감이 받는 날보다 앞이면 싣지 않는다"와 같은 규칙이다
      --   (클라 remind 의 fixedDue >= on ? fixedDue : null 을 서버로 옮긴 것). 비우면 claim 이 받은 날 + answer_days 로 정한다.
      update public.quiz_assignments
         set resend_at = now(), due_date = case when due_date >= v_today then due_date end
       where id = v_row.id;
    else
      select min(d::date) into v_on from generate_series(v_today, v_today + 60, interval '1 day') d
       where not exists (select 1 from public.quiz_assignments x
                          where x.course_id = p_course_id and x.user_id = v_uid and x.scheduled_on = d::date);
      if v_on is null then raise exception 'invalid_argument'; end if;
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by, due_date, resend_at)
      values (v_unit, p_course_id, v_uid, v_on, 'manual', auth.uid(), case when v_due >= v_on then v_due end, now());
    end if;

    if public.quiz_week_sends_full(v_unit, v_uid) then
      result := 'queued';
    else
      result := 'sent'; v_kick := true;
    end if;
    return next;
  end loop;

  if v_total > 0 and v_cool = v_total then raise exception 'resend_cooldown'; end if;
  if v_kick then perform public.quiz_kick_send_sweep(); end if;
end $$;
revoke all on function public.quiz_resend(text, uuid[]) from public, anon;
grant execute on function public.quiz_resend(text, uuid[]) to authenticated;

drop function if exists public.quiz_send_block(public.quiz_assignments, timestamptz);
drop function if exists public.quiz_send_due_at(public.quiz_assignments);
drop function if exists public.member_quiet_now(text, uuid, timestamptz);
commit;
