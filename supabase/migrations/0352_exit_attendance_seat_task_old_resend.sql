-- 0352 오류 탐지 11-03 A 묶음 — 옛 앱 다시 알리기 · 재직 종료 때 열린 출근 닫기 · 좌석 잠긴 직원 할 일 알림 (2026-11-05)
-- 지시서 = 산출물/오류탐지_2026-11-03/지시서_결함수정_2026-11-05.md 2절 · 결함표 = 보고.md 1절 1·2·3번
--
-- 옛 앱 호환: 안전 | 함수 drop 없음 · 서명·반환 열·권한 그대로. 새로 생기는 것은 트리거 하나뿐이다.
--   ① 옛 앱(android-v1.1.0 · ios-v1.1.0) 다시 알리기 = src/lib/db.ts insertQuizAssignments 의 사장 세션 upsert
--      (onConflict course_id,user_id,scheduled_on · ignoreDuplicates · .select('id')). 반환 행이 1개 이상이면 성공으로 친다.
--      나간 직원 행만 빠지고 남은 직원 행이 반환되므로 옛 앱은 "다시 보낼게요"를 띄운다. 전원이 나간 직원이면 0행 →
--      옛 앱의 재조회 count 가 모자라 "다시 알리지 못했어요"(지금과 같은 결과).
--      새 앱 quiz_resend(0348)는 나간 직원을 not_member 로 먼저 거르므로 이 트리거에 닿지 않는다.
--   ② close_member_tenure 는 서명 그대로 · 클라에 안 열린 내부 함수다(remove_staff · leave_store · delete_my_account 등이 부른다).
--   ③ due_task_reminders 는 크론 전용(push 엣지 index.ts:412). 반환 열 그대로.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   ① "나간 직원은 대상에서 뺀다"(11-04 결정)가 새 앱 RPC(quiz_resend)에만 있고, 옛 앱이 쓰는 테이블 쓰기 경로에는 RLS 멤버 조건(qz_insert)만 있었다.
--      RLS 는 행 하나라도 어기면 문장 전체를 42501 로 끝낸다 → 나간 직원 한 명 때문에 남은 직원도 못 받았다(보고 11절 재현).
--   ② 재직 종료(close_member_tenure)가 근무표·교대·방·퀴즈는 닫는데 출퇴근은 안 봤다 → 출근 중에 나간 사람의 기록이 퇴근 없이 남았다(라이브 1건).
--   ③ "좌석이 잠긴 직원에게는 보내지 않는다"(seat_locked_for · 0336)가 퀴즈 발송(0348)에만 있고 할 일 알림에는 없었다.
--
-- 고친 것
--   ⓐ quiz_assignments BEFORE INSERT: 앱 세션(authenticated)이 넣는 행 중 지금 그 매장 멤버가 아닌 사람의 행은 만들지 않는다(return null).
--      멤버 판정 = quiz_recipient_is_member(0348 · 한 곳). RLS(qz_insert)는 그대로 2선이다. service_role(운영·하니스 준비)은 거르지 않는다.
--      ★트리거 이름의 "a_" 는 실행 순서다. 같은 시점 트리거는 이름순으로 돈다. 나간 직원 행이 hidden_course·no_items 의 raise 에 먼저 닿지 않게 맨 앞에 둔다.
--   ⓑ close_member_tenure ⑤-2: 이 매장 열린 출근(퇴근 없음 · 옛 재직분 아님)을 지금 시각으로 닫는다(11-04 사용자 결정 "내보낸 시각").
--      내보냄·나감·탈퇴·다시 열기 모두 같다. 근무 분은 0322 attendance_staff_edit_guard 와 같은 식이다(정의자 안이라 그 트리거가 세지 않는다).
--      edited_by 는 건드리지 않는다. 직원이 누른 퇴근도, 사장이 고친 기록도 아니다.
--   ⓒ due_task_reminders: 담당자 필터(D3)와 매장 소속 필터(0153)에서 좌석이 잠긴 직원(junior·manager)을 뺀다. 판정 = seat_locked_for 하나.
--      ★사장은 판정에 넣지 않는다. seat_locked_for 는 직원 좌석 판정이라 사장 명단(unit_kept_seats)이 있으면 사장도 true 로 나온다(엣지 0317 도 매니저만 묻는다).
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): close_member_tenure 0247→0352 · due_task_reminders 0301→0352.
--   새: tg_quiz_assignment_skip_departed(트리거). 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 옛 앱 다시 알리기: 나간 직원 행만 빠진다 ──
create or replace function public.tg_quiz_assignment_skip_departed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if public.quiz_recipient_is_member(new.unit_id, new.user_id) then return new; end if;
  return null;
end $$;
revoke all on function public.tg_quiz_assignment_skip_departed() from public, anon, authenticated;
drop trigger if exists trg_quiz_assignment_a_skip_departed on public.quiz_assignments;
create trigger trg_quiz_assignment_a_skip_departed
  before insert on public.quiz_assignments
  for each row execute function public.tg_quiz_assignment_skip_departed();

-- ── ⓑ close_member_tenure (0247 본문 그대로 + ⑤-2) ──
create or replace function public.close_member_tenure(p_unit text, p_user uuid, p_reason text, p_notify boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_role  text;
  v_store boolean;
  v_ten   uuid;
  v_name  text;
  v_last4 text;
  v_wage  int;
  v_next  text;
  v_sname text;   -- ★0247: 알림 문구의 매장 이름
begin
  if p_reason is null or p_reason not in ('removed', 'left', 'reopen', 'account_deleted', 'owner_deleted') then
    raise exception 'invalid_reason';
  end if;
  -- ① 멤버십 잠금(직원 몫만). 없으면 할 일이 없다(두 번 불려도 안전).
  select m.role into v_role from public.unit_members m
   where m.unit_id = p_unit and m.user_id = p_user and m.role in ('junior', 'manager')
   for update;
  if not found then return false; end if;
  v_store := coalesce((select u.kind = 'store' from public.units u where u.id = p_unit), false);

  if v_store then
    -- ② 열린 기간. 없으면(백필 전 멤버 · 트리거를 거치지 않은 멤버십) 멤버십 생성 시각으로 만든다.
    select t.id into v_ten from public.member_tenures t
     where t.unit_id = p_unit and t.user_id = p_user and t.left_at is null
     for update;
    if v_ten is null then
      insert into public.member_tenures(unit_id, user_id, joined_at)
        select p_unit, p_user, m.created_at from public.unit_members m where m.unit_id = p_unit and m.user_id = p_user
      returning id into v_ten;
    end if;
    -- ③ 스냅샷 — 프로필이 지워지기 전에(탈퇴는 이 뒤에 전화번호를 지운다)
    select p.name, p.phone_last4 into v_name, v_last4 from public.profiles p where p.id = p_user;
    select w.hourly_wage into v_wage from public.wages w where w.unit_id = p_unit and w.staff_id = p_user::text;
  end if;

  -- ④ 멤버십 삭제 — 내보낸 사람이 switch_active_unit 으로 다시 들어오지 못한다.
  delete from public.unit_members where unit_id = p_unit and user_id = p_user and role in ('junior', 'manager');

  -- ⑤ 근무표 — 지우지 않고 닫는다(그 달 급여 근거 · 데이터 H4). 미래에만 있던 행만 지운다(0242 end_staff_tenure).
  perform public.end_staff_tenure(p_unit, p_user::text);

  -- ⑤-2 ★0352 출퇴근 — 열린 출근(퇴근 없음)은 지금 시각으로 닫는다(11-04 사용자 결정 "내보낸 시각" · 오류 탐지 11-03 2번).
  --   닫힌 기록·옛 재직분(archived_tenure_id)은 건드리지 않는다. 근무 분 = 0322 attendance_staff_edit_guard 와 같은 식
  --   (반올림 · 0 이상 · 24시간 상한). 정의자 안이라 그 트리거는 세지 않는다. edited_by 는 그대로 둔다.
  update public.attendance a
     set check_out = now(),
         work_minutes = least(24 * 60, greatest(0, round(extract(epoch from (now() - a.check_in)) / 60)::int))
   where a.unit_id = p_unit and a.staff_id = p_user::text
     and a.check_in is not null and a.check_out is null and a.archived_tenure_id is null;

  -- ⑥ 교대(0132 그대로) — 이 사람이 수락해 둔 남의 요청은 다시 열고, 이 사람이 올렸거나 지목된 미결 요청은 뺀다.
  --    확정·반려된 지난 건은 기록이라 남긴다.
  update public.swap_requests
     set status = 'open', accepted_by = null
   where unit_id = p_unit
     and accepted_by = p_user::text
     and status = 'accepted'
     and archived_tenure_id is null;
  delete from public.swap_requests
   where unit_id = p_unit
     and (requester_id = p_user::text or target_staff_id = p_user::text)
     and status in ('open', 'accepted')
     and archived_tenure_id is null;

  -- ⑦ 이 매장 방 멤버십(Q20 · 0237)
  delete from public.work_room_members
   where user_id = p_user
     and room_id in (select w.id from public.work_rooms w where w.unit_id = p_unit);

  -- ⑧ 이 사람 몫 좌석 선택 · 매장별 알림 설정(다시 들어오면 새 직원)
  delete from public.unit_kept_seats   where unit_id = p_unit and user_id = p_user;
  delete from public.unit_member_prefs where unit_id = p_unit and user_id = p_user;

  -- ⑨ 아직 안 보낸 퀴즈(sent_at is null). 보낸 것 · 푼 것은 기록이라 남긴다.
  delete from public.quiz_assignments where unit_id = p_unit and user_id = p_user and sent_at is null;

  -- ⑩ 포인터 재지정: 이 매장이 주매장/활성이면 남은 소속으로(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = p_user and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = p_unit then v_next else unit_id end,
         active_unit_id = case when active_unit_id = p_unit then v_next else active_unit_id end
   where id = p_user;

  -- ⑪ 기간 닫기
  if v_store then
    update public.member_tenures
       set left_at = now(), left_reason = p_reason, role_at_end = v_role,
           name_snapshot = v_name, phone_last4 = v_last4, final_hourly_wage = v_wage
     where id = v_ten;
  end if;

  -- ⑫ ★0247(Q22) 알림 — 내보냄은 그 직원에게, 나감·탈퇴는 그 매장 사장 멤버십에게만(매니저 제외 · F-2).
  --   다시 열기(reopen)는 p_notify = false. 작업실은 재직 기간처럼 건너뛴다(v_store). 크론이 deliver() 로 보낸다.
  if p_notify and v_store then
    select u.store_name into v_sname from public.units u where u.id = p_unit;
    if p_reason = 'removed' then
      insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
      values (p_user, p_unit, 'removed', v_sname, format('%s 구성원에서 빠졌어요', coalesce(v_sname, '매장')),
              '궁금한 점은 사장님께 문의해 주세요.', '/stores');
    elsif p_reason in ('left', 'account_deleted') then
      insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
      select m.user_id, p_unit, p_reason, v_sname, v_name,
             case when p_reason = 'left' then format('%s님이 매장을 나갔어요', coalesce(v_name, '직원'))
                  else format('%s님이 탈퇴해 매장에서 빠졌어요', coalesce(v_name, '직원')) end,
             format('%s 근무표를 확인해 주세요.', coalesce(v_sname, '매장')), '/owner/staff'
        from public.unit_members m
       where m.unit_id = p_unit and m.role = 'owner' and m.user_id <> p_user;
    end if;
  end if;
  return true;
end $$;
revoke all on function public.close_member_tenure(text, uuid, text, boolean) from public, anon, authenticated;

-- ── ⓒ due_task_reminders (0301 본문 그대로 + 좌석 잠김 두 줄) ──
create or replace function public.due_task_reminders()
returns table(out_template_id text, out_unit_id text, out_text text, out_date text, out_recipients text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamp := (now() at time zone 'Asia/Seoul');
  v_day   text := to_char(v_now, 'YYYY-MM-DD');
  v_time  text := to_char(v_now, 'HH24:MI');
  -- 크론이 멈췄다 복구했을 때 옛 알림이 한꺼번에 터지지 않게 "지난 1시간 내 도달분"만(0118).
  -- ★자정 직후엔 하한이 '23:xx' 가 되어 뒤집히므로 그때는 하한을 적용하지 않는다 —
  --   아래 `(v_floor >= v_time or ...)` 의 앞항이 그 예외다. 이유를 모르고 지우면 자정 알림이 전멸한다.
  v_floor text := to_char(v_now - interval '60 minutes', 'HH24:MI');
  -- ★D6: 어제 날짜. 자정 직후 틱에서 어제 23:56~23:59 할일을 어제 날짜로 보낸다.
  v_prev  text := to_char(v_now - interval '1 day', 'YYYY-MM-DD');
  t record;
  v_rec text[];
begin
  for t in
    select w.id, w.unit_id, w.text, w.remind_at, w.owner_ids, w.scope, c.d as cand_day from public.work_templates w
    cross join lateral (
      -- 오늘 도달분
      select v_day as d where w.remind_at <= v_time and (v_floor >= v_time or w.remind_at > v_floor)
      union all
      -- ★D6: 자정 직후 틱(하한이 뒤집힌 00:00~00:59)에는 어제 하한 뒤 미발송분도 어제 날짜로.
      --   크론이 5분 간격이라 23:56~23:59 는 23:55 틱에선 아직이고 00:00 틱에선 날짜가 바뀌어 영영 빠졌다.
      --   원장(task_reminder_sent)이 (할일, 날짜) 하나라 어제 이미 보낸 것은 다시 안 나간다.
      select v_prev where v_floor >= v_time and w.remind_at > v_floor
    ) c
    where w.remind_at is not null and not public.unit_access_locked(w.unit_id)
      and public.task_occurs_on(w.recurrence, w.date, w.due_date, w.hidden, c.d)
      and not exists (
        select 1 from public.task_reminder_sent s
        where s.template_id = w.id and s.remind_date = c.d
      )
      and not exists (
        select 1 from public.work_done d
        where d.unit_id = w.unit_id and d.work_date = c.d and d.template_id = w.id
      )
    union all
    -- ★D1: 루틴 업무(schedule_config.dayparts 의 routines[].remindAt). 매일 반복 · 매장 전체 할일 · assigneeId = 담당자.
    --   id 규칙은 앱(daypartLabels.ts normalizeRoutines · useWorkStore daypartRoutineTemplates)과 같다.
    select 'dpr_' || r.rid, r.unit_id, r.text, r.remind_at,
           case when r.assignee ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then array[r.assignee::uuid] else '{}'::uuid[] end,
           'shared'::text, c.d
      from (
        select sc.unit_id,
               coalesce(nullif(rt.value->>'id', ''),
                        coalesce(nullif(dp.value->>'id', ''), 'dp_' || (dp.ord - 1)) || '_rt_' || (rt.ord - 1)) as rid,
               coalesce(rt.value->>'text', '') as text,
               btrim(rt.value->>'remindAt') as remind_at,
               nullif(rt.value->>'assigneeId', '') as assignee
          from public.schedule_config sc
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(sc.dayparts) = 'array' then sc.dayparts else '[]'::jsonb end) with ordinality dp(value, ord)
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(dp.value -> 'routines') = 'array' then dp.value -> 'routines' else '[]'::jsonb end) with ordinality rt(value, ord)
         where jsonb_typeof(rt.value) = 'object'
           and btrim(coalesce(rt.value->>'remindAt', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ) r
    cross join lateral (
      select v_day as d where r.remind_at <= v_time and (v_floor >= v_time or r.remind_at > v_floor)
      union all
      select v_prev where v_floor >= v_time and r.remind_at > v_floor
    ) c
    where not public.unit_access_locked(r.unit_id)
      -- 그날 '오늘 하루만 수정' 대체본(0146)이 있으면 원본 루틴은 그날 뜨지 않는다(앱 skipDates 와 같다).
      and not exists (
        select 1 from public.work_templates x
        where x.unit_id = r.unit_id and x.replaces_routine_id = r.rid and coalesce(x.date, x.due_date) = c.d
      )
      and not exists (
        select 1 from public.task_reminder_sent s
        where s.template_id = 'dpr_' || r.rid and s.remind_date = c.d
      )
      and not exists (
        select 1 from public.work_done d
        where d.unit_id = r.unit_id and d.work_date = c.d and d.template_id = 'dpr_' || r.rid
      )
  loop
    v_rec := '{}'::text[];
    -- 담당자가 있으면 private·shared 모두 담당자 전원(근무 여부 무관 · 0254).
    if cardinality(t.owner_ids) > 0 then
      v_rec := t.owner_ids::text[];
      -- ★D3: 지금 매장 멤버인 담당자만 남긴다.
      -- ★0352: 좌석이 잠긴 직원 담당자도 뺀다(나간 담당자와 같다 · 모두 빠지면 매장 전체 할일은 근무자에게 간다).
      select coalesce(array_agg(x), '{}'::text[]) into v_rec
      from unnest(v_rec) x
      where exists (
        select 1 from public.unit_members m
        where m.unit_id = t.unit_id and m.user_id = x::uuid
          and (m.role not in ('junior', 'manager') or not public.seat_locked_for(t.unit_id, m.user_id))
      );
    end if;

    -- 담당 없는 할일, 또는 담당자가 모두 나간 매장 전체 할일 → 그 시각 근무자.
    if cardinality(t.owner_ids) = 0
       or (coalesce(array_length(v_rec, 1), 0) = 0 and t.scope is distinct from 'private') then
      select coalesce(array_agg(distinct x), '{}'::text[]) into v_rec
      from public.workers_at(t.unit_id, t.cand_day, t.remind_at) x;
      -- 그 시각 근무자가 없을 때:
      --   · 근무표를 안 쓰는 매장 → 매장 전원(fail-open, 0118). 여기서 닫으면 '전체 할일' 알림이 통째로 사라진다.
      --   · ★D7: 근무표를 쓰는 매장(근무표에 한 사람이라도 있다) → 보내지 않는다. 쉬는 사람에게 가지 않게.
      --     "근무표를 쓴다"는 퀴즈 발송(due_quiz_sends · 0248)과 같은 판정이다. 이미 끝난 반복 행은 세지 않는다.
      if coalesce(array_length(v_rec, 1), 0) = 0
         and not public.unit_uses_schedule(t.unit_id, t.cand_day::date) then   -- ★0301: 판정 함수 하나(퀴즈와 같음)
        select coalesce(array_agg(m.user_id::text), '{}'::text[]) into v_rec
        from public.unit_members m where m.unit_id = t.unit_id;
      end if;
    end if;

    -- ★매장 소속 필터(0153). owner_id 에 아무 uuid 나 꽂아 임의 사용자에게 푸시를 보내는
    --   경로(0127 C1)를 여기서 닫는다. 위 갈래 어느 쪽으로 왔든 한 번에 거른다.
    -- ★0352: 무료 인원 한도로 좌석이 잠긴 직원(seat_locked_for · 0336)도 여기서 뺀다. 퀴즈 발송(0348 due_quiz_sends)과 같은 판정이다.
    --   사장은 판정하지 않는다(seat_locked_for 는 직원 좌석 판정 · 엣지 0317 도 매니저만 묻는다).
    if coalesce(array_length(v_rec, 1), 0) > 0 then
      select coalesce(array_agg(x), '{}'::text[]) into v_rec
      from unnest(v_rec) x
      where exists (
        select 1 from public.unit_members m
        where m.unit_id = t.unit_id and m.user_id = x::uuid
          and (m.role not in ('junior', 'manager') or not public.seat_locked_for(t.unit_id, m.user_id))
      );
    end if;

    if coalesce(array_length(v_rec, 1), 0) > 0 then
      out_template_id := t.id;
      out_unit_id     := t.unit_id;
      out_text        := t.text;
      out_date        := t.cand_day;
      out_recipients  := v_rec;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.due_task_reminders() from public, anon, authenticated;
grant execute on function public.due_task_reminders() to service_role;
