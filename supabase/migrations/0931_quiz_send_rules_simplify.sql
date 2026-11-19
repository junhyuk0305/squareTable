-- 0931 퀴즈 발송 규칙 정리 · 보낼 시각 · 방해금지 · 재확인 멈춤 · 다시 알리기 1분 · 이유 판정 한 곳
--   (2026-11-19 · 첫 사용 수정 B8 · 정본 = 산출물/첫사용측정_2026-11-17/세션A_첫사용수정_멀티에이전트_2026-11-19.md "B8 재설계 결정")
-- 옛 앱 호환: 안전 | 확장 + 판정 완화만 한다.
--   열 하나(send_at · null 허용)를 더한다. 옛 앱은 이 열을 모르고 행을 넣는다 → null → 예약일 09:00 KST 에 나간다.
--   RPC 이름·인자·반환 열은 전부 그대로다(due_quiz_sends · quiz_send_status · recipient_readiness · quiz_resend · quiz_send_now).
--   quiz_send_status 의 새 이유 코드(seat_locked · due_passed · quiet · store_locked)를 옛 앱은 모른다 →
--     옛 앱은 readinessText(모르는 코드) = undefined → '발송 전' 으로 떨어진다(ios-v1.1.1 quiz/[id].tsx:187 확인).
--   recipient_readiness 의 on_schedule 은 늘 true, weekly_quota_left 는 늘 2 를 준다. 옛 앱이 "근무표에 없어…"·"최근 7일에 2번…"을 띄우지 않게 한다.
--   옛 앱 문구("근무 시간에 맞춰 보내요" 등)는 다음 앱 빌드에서 고친다(사용자 감수 · 2026-11-19).
--
-- 무엇이 어긋났나(계층 · 규칙)
--   ① 화면 이유(quiz_send_status 0301)와 실제 발송(due_quiz_sends 0930)이 서로 다른 술어를 따로 들고 있었다.
--      다시 알리기·지금 바로 행을 화면은 막혔다고 말했고, 서버가 막는 넷(좌석 잠김·다 푼 사람·7일 2회·마감 지남)을 화면은 몰랐다.
--   ② 사용자 결정(2026-11-19)으로 발송 제한 넷을 지운다: 근무 시간 · 하루 1회 · 7일 2회 · 두 번 안 열면 자동 정지.
--      한 스윕에 한 사람 1건(v_taken)도 지운다 → 여러 퀴즈가 한 번에 간다.
--
-- 고친 것
--   ⓐ 열 send_at = 사장이 고른 보낼 시각(새 앱). null 이면 예약일 09:00 KST(옛 앱 · 시간 칸이 없다).
--   ⓑ quiz_send_block(행) = 이 행이 지금 나갈 수 없는 이유 하나(null = 지금 나감). **판정은 여기 한 곳이다.**
--      due_quiz_sends 는 "null 인 행", quiz_send_status 는 "그 이유"를 쓴다 → 화면과 발송이 같은 답을 낸다(B8).
--      늘 막는 것 = 매장 잠김·삭제 · 낼 문항 0개 · 나간 직원 · 다 푼 사람 · 좌석 잠김 · 마감 지남(지금 규칙 그대로).
--      새로 막는 것 = 보낼 시각 전 · 그 매장 방해금지 시간(끝나면 다음 스윕에 쌓인 것이 같이 간다).
--      재확인(origin='recheck') 행은 보내지 않는다(재확인 기능 없앰 · 사용자 결정). 안 나간 재확인 행은 아래 ⓖ 가 지운다.
--   ⓒ member_quiet_now = 그 매장 방해금지 판정. 엣지 push/index.ts inQuietWindow 와 같은 셈([시작, 끝) · 자정 넘김 · 같으면 빈 구간).
--   ⓓ due_quiz_sends: 재확인 큐 채우기(enqueue_knowhow_rechecks 호출)를 멈춘다. 후보 = quiz_send_block(행) is null.
--   ⓔ quiz_resend: 7일 상한을 지운다(늘 sent). 쿨다운 10분 → 1분(quiz_resend_cooldown).
--   ⓕ quiz_send_now: 보낼 시각이 미래인 행(send_at > now)에는 표시를 세우지 않는다(나중 시각 예약을 앞당기지 않는다).
--   ⓖ 안 나간 재확인 행을 지운다. 응시·답 기록은 행에 없고 나간 행은 건드리지 않는다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧):
--   due_quiz_sends 0930 → 0931 · quiz_send_status 0301 → 0931 · recipient_readiness 0312 → 0931 ·
--   quiz_resend 0348 → 0931 · quiz_resend_cooldown 0348 → 0931 · quiz_send_now 0930 → 0931.
--   새: quiz_send_block · quiz_send_due_at · member_quiet_now.
--   쓰지 않게 된 것(지우지 않음 · 되돌리기용): enqueue_knowhow_rechecks(0367) · quiz_week_sends_full(0348) · quiz_send_notified(0349).
-- 되돌리기 = scripts/rollback/0931.sql (열은 남긴다 · 새 앱이 쓴다 · ⓖ 로 지운 대기 행은 되돌리면 재확인 큐가 다시 만든다).
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 보낼 시각 열 ──
alter table public.quiz_assignments
  add column if not exists send_at timestamptz;
comment on column public.quiz_assignments.send_at is
  '사장이 고른 보낼 시각(0931). null 이면 예약일(scheduled_on) 09:00 KST. resend_at(다시 알리기)·send_now(지금 바로) 행은 이 값과 상관없이 바로 후보다.';

-- ── ⓒ 그 매장 방해금지 시간인가 ──
-- 설정 = unit_member_prefs(0076) quiet_enabled · quiet_start · quiet_end("HH:MM" KST · 형식은 CHECK 가 지킨다).
-- 행이 없으면 방해금지 꺼짐(기본값). 엣지 inQuietWindow 와 같은 셈이다. 한쪽을 바꾸면 다른 쪽도 같이 바꾼다.
create or replace function public.member_quiet_now(p_unit text, p_user uuid, p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.quiet_enabled and p.quiet_start <> p.quiet_end and (
             case when p.quiet_start < p.quiet_end
                  then k.hm >= p.quiet_start and k.hm < p.quiet_end
                  else k.hm >= p.quiet_start or k.hm < p.quiet_end end)
      from public.unit_member_prefs p
      cross join (select to_char(p_now at time zone 'Asia/Seoul', 'HH24:MI') as hm) k
     where p.unit_id = p_unit and p.user_id = p_user), false)
$$;
revoke all on function public.member_quiet_now(text, uuid, timestamptz) from public, anon, authenticated;

-- ── 이 행을 보낼 시각 ──
-- 다시 알리기(resend_at) = 누른 시각 · 지금 바로(send_now) = 만든 시각 · 그 밖 = send_at, 없으면 예약일 09:00 KST.
create or replace function public.quiz_send_due_at(a public.quiz_assignments)
returns timestamptz language sql stable set search_path = public as $$
  select case
    when a.resend_at is not null then a.resend_at
    when a.send_now then a.created_at
    else coalesce(a.send_at, (a.scheduled_on + time '09:00') at time zone 'Asia/Seoul')
  end
$$;
revoke all on function public.quiz_send_due_at(public.quiz_assignments) from public, anon, authenticated;

-- ── ⓑ 지금 나갈 수 없는 이유 (판정 한 곳) ──
-- 반환 = null(지금 나감) 또는 이유 코드. 순서가 곧 우선순위다(화면에는 첫 이유 하나만 보인다).
--   sent         이미 나감
--   retired      재확인 행(재확인 기능 없앰 · 2026-11-19)
--   store_locked 매장 삭제·이용 멈춤(unit_access_locked)
--   no_items     낼 문항 0개 · 보관·본사 숨김(quiz_course_servable · 0327·0332)
--   not_member   나간 직원(quiz_recipient_is_member · 0348)
--   completed    그 퀴즈를 다 푼 사람(quiz_course_done_by · 0348 · 11-04 사용자 결정)
--   seat_locked  무료 인원을 넘어 잠긴 직원(seat_locked_for · 0336)
--   due_passed   사장이 고른 마감이 지남(0348 · 보내면 받자마자 마감 지난 퀴즈가 된다)
--   not_yet      보낼 시각 전(quiz_send_due_at)
--   quiet        그 매장 방해금지 시간(member_quiet_now) · 끝나면 다음 스윕에 나간다
-- ★지운 것(2026-11-19 사용자 결정): 근무 시간 · 하루 1회 · 7일 2회 · 연속 2회 무시 자동 정지.
create or replace function public.quiz_send_block(a public.quiz_assignments, p_now timestamptz default now())
returns text language sql stable security definer set search_path = public as $$
  select case
    when a.sent_at is not null then 'sent'
    when a.origin = 'recheck' then 'retired'
    when not exists (select 1 from public.units u where u.id = a.unit_id and u.deleted_at is null)
      or public.unit_access_locked(a.unit_id) then 'store_locked'
    when not exists (select 1 from public.quiz_course_servable(a.unit_id, a.course_id)) then 'no_items'
    when not public.quiz_recipient_is_member(a.unit_id, a.user_id) then 'not_member'
    when public.quiz_course_done_by(a.unit_id, a.course_id, a.user_id) then 'completed'
    when public.seat_locked_for(a.unit_id, a.user_id) then 'seat_locked'
    when a.due_date is not null and a.due_date < (p_now at time zone 'Asia/Seoul')::date then 'due_passed'
    when public.quiz_send_due_at(a) > p_now then 'not_yet'
    when public.member_quiet_now(a.unit_id, a.user_id, p_now) then 'quiet'
    else null
  end
$$;
revoke all on function public.quiz_send_block(public.quiz_assignments, timestamptz) from public, anon, authenticated;

-- ── ⓓ 예약 발송 (베이스 = 0930 · 본문을 quiz_send_block 한 줄로 바꿨다) ──
-- 반환 열·권한은 그대로다(push 엣지 task_reminders 모드가 부른다 · 엣지 배포 불필요).
-- ★재확인 큐 채우기(§0 enqueue_knowhow_rechecks)를 더 부르지 않는다(재확인 기능 없앰).
-- ★v_taken(한 스윕에 한 사람 1건)을 지웠다. 같은 사람의 여러 퀴즈가 한 스윕에 같이 나간다(2026-11-19 사용자 결정).
-- 앞거름(sent_at null · 예약일 오늘 이하 또는 다시 알리기)은 색인을 타게 두는 것이고 판정은 quiz_send_block 이 한다.
--   send_at 은 예약일 안의 시각이라(새 앱이 같은 날로 넣는다) 예약일 앞거름에 걸리지 않는다.
create or replace function public.due_quiz_sends()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := now();
  v_date date := (v_now at time zone 'Asia/Seoul')::date;
begin
  return query
    select qa.id, qa.unit_id, qa.user_id::text, c.name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
     where qa.sent_at is null
       and (qa.scheduled_on <= v_date or qa.resend_at is not null)
       and public.quiz_send_block(qa, v_now) is null
     order by qa.created_at;
end $$;
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant execute on function public.due_quiz_sends() to service_role;

-- ── 사람별 아직 안 나간 이유 (베이스 = 0301 · 판정을 quiz_send_block 으로 바꿨다 · B8) ──
-- 반환 모양 그대로(user_id, reason). 사장·매니저만(그 밖엔 0행 · 0301 그대로).
-- 그 퀴즈의 안 나간 행 중 사람마다 보낼 시각이 가장 이른 행 하나를 본다. 화면에 말할 이유만 돌려준다:
--   seat_locked · due_passed · quiet · store_locked. not_yet 은 화면이 예약 시각으로 말하고(sendPhase),
--   sent·retired·no_items·not_member·completed 는 사람 줄의 다른 상태가 말한다.
create or replace function public.quiz_send_status(p_course_id text)
returns table(user_id uuid, reason text)
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_unit text;
begin
  if not public.auth_can_manage() then return; end if;
  select c.unit_id into v_unit
    from public.training_courses c
   where c.id = p_course_id and c.unit_id = public.auth_unit_id();
  if v_unit is null then return; end if;

  return query
    select s.user_id, s.reason
      from (
        select distinct on (qa.user_id) qa.user_id, public.quiz_send_block(qa) as reason
          from public.quiz_assignments qa
         where qa.unit_id = v_unit and qa.course_id = p_course_id
           and qa.sent_at is null and qa.origin <> 'recheck'
         order by qa.user_id, public.quiz_send_due_at(qa), qa.created_at
      ) s
     where s.reason in ('seat_locked', 'due_passed', 'quiet', 'store_locked');
end $$;
revoke all on function public.quiz_send_status(text) from public, anon;
grant execute on function public.quiz_send_status(text) to authenticated;

-- ── 받는 사람 준비 상태 (베이스 = 0312 · 근무표·주 상한 판정을 뺐다) ──
-- 반환 모양 그대로. on_schedule = 늘 true · weekly_quota_left = 늘 2 · blocked_reason 에서 not_scheduled 가 빠진다.
--   퀴즈가 근무 시간·주 2회를 더 보지 않으므로 옛 앱이 "근무표에 없어…"·"최근 7일에 2번…"을 띄우지 않게 하는 값이다.
--   (열을 지우면 옛 앱 읽기가 깨진다 · ⑪ 확장 → 축소)
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
  u uuid;
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

    -- ★0931: 근무표 판정을 뺐다(퀴즈가 근무 시간을 더 보지 않는다).
    on_schedule := true;
    -- ★0931: 7일 2회 상한이 없어졌다. 옛 앱이 "0 남음"으로 읽지 않게 옛 최댓값을 준다.
    weekly_quota_left := 2;

    blocked_reason := case
      when not has_device then 'no_device'
      when not push_on    then 'push_off'
      else null
    end;

    return next;
  end loop;
end $$;
revoke all on function public.recipient_readiness(text, uuid[]) from public, anon, authenticated;
grant  execute on function public.recipient_readiness(text, uuid[]) to authenticated;

-- ── ⓔ 다시 알리기 쿨다운 1분 (2026-11-19 사용자 결정 · 10분이었다) ──
create or replace function public.quiz_resend_cooldown()
returns interval language sql immutable as $$ select interval '1 minute' $$;
revoke all on function public.quiz_resend_cooldown() from public, anon, authenticated;

-- ── ⓔ 다시 알리기 (베이스 = 0348:236 · 7일 상한 판정만 뺐다) ──
-- 반환 result: sent · cooldown · completed · locked · not_member. ★0931: queued(7일 상한)는 더 나오지 않는다.
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
    -- 무료 인원 한도를 넘어 잠긴 직원(정본 seat_locked_for · 0336)은 받지 않는다. quiz_send_block 과 같은 판정이다.
    if public.seat_locked_for(v_unit, v_uid) then
      result := 'locked'; return next; continue;
    end if;
    -- ⓗ 그 퀴즈를 다 푼 사람은 다시 받지 않는다(2026-11-04 사용자 결정). 행을 만들지도 고치지도 않는다.
    if public.quiz_course_done_by(v_unit, p_course_id, v_uid) then
      result := 'completed'; return next; continue;
    end if;
    -- 쿨다운 기준 = 마지막 다시 알리기 요청(resend_at) 하나. 일반 발송(첫 발송·크론)은 세지 않는다. ★0931: 1분.
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
      -- 마감(0291 due_date)이 이미 지났으면 비운다. 새 행의 "마감이 받는 날보다 앞이면 싣지 않는다"와 같은 규칙이다.
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

    -- ★0931: 7일 상한이 없어 늘 지금 보낸다(방해금지 시간이면 quiz_send_block 이 끝날 때까지 미룬다).
    result := 'sent'; v_kick := true;
    return next;
  end loop;

  if v_total > 0 and v_cool = v_total then raise exception 'resend_cooldown'; end if;
  if v_kick then perform public.quiz_kick_send_sweep(); end if;
end $$;
revoke all on function public.quiz_resend(text, uuid[]) from public, anon;
grant execute on function public.quiz_resend(text, uuid[]) to authenticated;

-- ── ⓕ 지금 바로 (베이스 = 0930 · 대상 줄에 send_at 조건 하나) ──
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

  -- race: 표시 update 는 멱등이고 행을 새로 만들지 않는다. 실제 발송의 한 번은 claim_quiz_send 의 조건부 update 가 지킨다.
  update public.quiz_assignments a
     set send_now = true
   where a.unit_id = v_unit and a.course_id = p_course_id
     and a.sent_at is null and a.scheduled_on <= v_today and not a.send_now
     -- 사장이 보낸 행만(합류·재확인 행은 표시하지 않는다).
     and a.origin = 'manual'
     -- ★0931: 오늘 안의 나중 시각으로 예약한 행은 앞당기지 않는다.
     and (a.send_at is null or a.send_at <= now());

  select count(*)::int into v_n from public.quiz_assignments a
   where a.unit_id = v_unit and a.course_id = p_course_id and a.send_now and a.sent_at is null;

  if v_n > 0 then perform public.quiz_kick_send_sweep(); end if;
  return v_n;
end $$;
revoke all on function public.quiz_send_now(text) from public, anon;
grant execute on function public.quiz_send_now(text) to authenticated;

-- ── ⓖ 안 나간 재확인 행을 지운다 (재확인 기능 없앰) ──
-- 나간 재확인 행(sent_at 있음)과 그 답은 그대로다. 대기 행에는 응시 기록이 없다.
delete from public.quiz_assignments where origin = 'recheck' and sent_at is null;

-- ── 자가점검 ──
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.due_quiz_sends()'::regprocedure;
  if v_src ~ 'enqueue_knowhow_rechecks' or v_src ~ 'workers_at' or v_src ~ 'quiz_week_sends_full' or v_src !~ 'quiz_send_block' then
    raise exception '0931 자가점검 실패 — due_quiz_sends 본문';
  end if;
  if has_function_privilege('authenticated', 'public.quiz_send_block(public.quiz_assignments, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.member_quiet_now(text, uuid, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.due_quiz_sends()', 'execute') then
    raise exception '0931 자가점검 실패 — 내부 함수가 authenticated 에 열렸다';
  end if;
  if public.quiz_resend_cooldown() <> interval '1 minute' then
    raise exception '0931 자가점검 실패 — 쿨다운';
  end if;
end $$;
