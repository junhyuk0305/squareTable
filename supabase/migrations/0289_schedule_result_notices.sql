-- 0289_schedule_result_notices.sql — 근무 변경 결과를 당사자 직원에게 알린다 (2026-10-06 · 논리 점검 D9 · 사장님 결정 '추천안')
--
-- 예전: 대타를 받은 사람은 사장이 승인해도 몰랐다(요청자에게만 알림). 시간 수정 요청을 승인·반려해도 직원에게 알림이 없었다.
--   사장이 근무를 추가 · 수정 · 삭제해도 그 직원은 근무표를 열어 봐야 알았다.
--
-- 바꾸는 것(퇴근 미기록 알림은 만들지 않는다 · 결정)
--   ① member_notices.kind 에 swap_confirmed · shift_time_result · shift_changed 를 더한다.
--      이 표는 0247 구성원 알림 대기열이다. 5분 크론(엣지 push sweepMemberNotices)이 행의 title · body · url 그대로 푸시한다.
--      엣지는 바꾸지 않는다(배포 불필요). 직원 알림함은 앱이 이 행을 읽어 보여 준다(useScheduleStore · notifications.ts).
--   ② put_schedule_notice — 내부 헬퍼(클라 실행 불가). 이 매장 멤버에게만 · 본인 제외 · 아직 안 나간 같은 문구는 다시 넣지 않는다.
--      알림 적재가 실패해도 본 작업(승인 · 결정)은 되돌리지 않는다(0247 과 같은 태도).
--   ③ approve_swap(0279 본문 그대로) 끝에 받은 사람(accepted_by · 대타 · 맞교환 상대)에게 알림 한 줄.
--   ④ decide_shift_time(0279 본문 그대로) 승인 · 반려 끝에 요청 직원에게 알림 한 줄.
--      그날 근무가 바뀌어 요청을 자동으로 닫는 경우는 알리지 않는다(결정 범위 밖).
--   ⑤ notify_shift_changed(p_staff, p_date, p_onward) — 사장 · 매니저가 근무를 추가 · 수정 · 삭제 · 되돌린 뒤 앱이 부른다.
--      근무 편집 경로가 여럿(직접 insert · 예외 삭제 · RPC 4개)이라 저장이 성공한 뒤 앱이 한 번 부른다. 옛 앱은 부르지 않는다.
--
-- 함수 담당표: approve_swap 0279 → 0289 · decide_shift_time 0279 → 0289. 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.

-- ── ① 종류 ──────────────────────────────────────────────────────────────────
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check
  check (kind in ('approved', 'rejected', 'removed', 'left', 'account_deleted', 'owner_deleted', 'question_answered',
                  'swap_confirmed', 'shift_time_result', 'shift_changed'));

-- ── ② 헬퍼 ──────────────────────────────────────────────────────────────────
-- '10월 8일(화)'. 알림 문구용.
create or replace function public.schedule_notice_day(p_date date)
returns text language sql stable set search_path = public as $$
  select to_char(p_date, 'FMMM"월" FMDD"일"') || '(' || (array['일', '월', '화', '수', '목', '금', '토'])[extract(dow from p_date)::int + 1] || ')'
$$;
revoke all on function public.schedule_notice_day(date) from public, anon, authenticated;

create or replace function public.put_schedule_notice(p_unit text, p_user text, p_kind text, p_title text, p_body text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if p_unit is null or p_user is null
     or p_user !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  -- 본인이 한 일은 본인에게 알리지 않는다.
  if p_user = auth.uid()::text then return false; end if;
  -- 이 매장 멤버에게만(나간 사람 · 다른 매장 사람에게 가지 않게).
  if not exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_user::uuid) then
    return false;
  end if;
  -- 아직 안 나간 같은 알림이 있으면 다시 넣지 않는다(같은 근무를 연달아 고친 경우).
  if exists (select 1 from public.member_notices n
              where n.user_id = p_user::uuid and n.unit_id = p_unit and n.kind = p_kind
                and n.body = p_body and n.claimed_at is null) then
    return true;
  end if;
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    values (p_user::uuid, p_unit, p_kind, (select u.store_name from public.units u where u.id = p_unit),
            p_title, p_body, '/junior/schedule');
  exception when others then
    -- 알림 적재가 실패해도 본 작업은 되돌리지 않는다(0247).
    return false;
  end;
  return true;
end $$;
revoke all on function public.put_schedule_notice(text, text, text, text, text) from public, anon, authenticated;

-- ── ③ approve_swap (0279 본문 그대로 + 받은 사람 알림) ──────────────────────
create or replace function public.approve_swap(p_id text, p_confirm_past boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare s record; v_earliest text;
begin
  if not public.auth_can_manage() then return false; end if;
  select * into s from public.swap_requests where id = p_id for update;
  if not found then return false; end if;
  if s.archived_tenure_id is not null then return false; end if;   -- ★0246: 재입사 전 옛 요청은 기록이다
  if s.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if s.status <> 'accepted' or s.accepted_by is null then return false; end if;
  -- ★0242: 요청이 가리키는 근무는 요청과 같은 매장이어야 한다. swap_insert(0019)는 template_id 의 매장을 보지 않아서
  --   직원이 다른 매장 근무 id 로 요청을 만들 수 있다(0179 부터 있던 구멍 · 다른 매장 근무표와 급여가 바뀐다).
  --   ★0246: 표시된 옛 근무도 같은 이유로 거부한다.
  if not exists (select 1 from public.shift_templates t where t.id = s.template_id and t.unit_id = s.unit_id
                   and t.archived_tenure_id is null) then
    return false;
  end if;
  if s.kind = 'swap' and s.target_template_id is not null
     and not exists (select 1 from public.shift_templates t where t.id = s.target_template_id and t.unit_id = s.unit_id
                       and t.archived_tenure_id is null) then
    return false;
  end if;
  -- ★리뷰 2026-10-05: 수락이 진짜인지 본다. 꾸민 요청으로 동료 근무와 급여를 옮기지 못하게 한다.
  --   넘기는 근무는 요청자 것 · 수락자는 이 매장 멤버 · 지정 발송이면 목록 안(accept_swap 과 같은 판정)
  --   · 맞교환 상대 근무는 수락자 것.
  if not exists (select 1 from public.shift_templates t where t.id = s.template_id and t.staff_id = s.requester_id) then
    return false;
  end if;
  if not exists (select 1 from public.unit_members m where m.unit_id = s.unit_id and m.user_id::text = s.accepted_by) then
    return false;
  end if;
  if coalesce(s.target_staff_ids, case when s.target_staff_id is null then null else array[s.target_staff_id] end) is not null
     and not (s.accepted_by = any (coalesce(s.target_staff_ids, array[s.target_staff_id]))) then
    return false;
  end if;
  if s.kind = 'swap' and s.target_template_id is not null
     and not exists (select 1 from public.shift_templates t where t.id = s.target_template_id and t.staff_id = s.accepted_by) then
    return false;
  end if;

  -- ★0242(Q10): 근무일이 지나도 35일 동안은 승인할 수 있다. 그보다 오래된 근무는 승인하지 않는다.
  v_earliest := case when s.kind = 'swap' and s.target_date is not null and s.target_date < s.date then s.target_date else s.date end;
  if v_earliest < to_char(public.kst_today() - 35, 'YYYY-MM-DD') then return false; end if;
  -- ★0242(Q4): 지난 근무를 승인하면 그 기간 급여가 바뀐다 → 앱이 경고를 거친 뒤 p_confirm_past=true 로 다시 부른다.
  if v_earliest < to_char(public.kst_today(), 'YYYY-MM-DD') and not coalesce(p_confirm_past, false) then
    raise exception 'confirm_past_required';
  end if;

  -- 요청자가 내놓은 근무(또는 그 구간)를 수락자에게
  if not public.transfer_shift(s.template_id, s.date, s.accepted_by, s.part_start, s.part_end) then
    return false;  -- 근무가 사라졌거나 구간이 근무 밖 → 승인 자체를 하지 않는다(반쪽 승인 금지)
  end if;
  -- 맞교환이면 상대 근무를 요청자에게(맞교환에는 구간 개념을 붙이지 않는다 — 전체만)
  if s.kind = 'swap' and s.target_template_id is not null and s.target_date is not null then
    if not public.transfer_shift(s.target_template_id, s.target_date, s.requester_id, null, null) then
      -- ★0242: 앞 이전까지 되돌린다(return false 로 끝내면 요청자 근무만 넘어간 반쪽 상태가 남는다).
      raise exception 'swap_target_unavailable';
    end if;
  end if;

  update public.swap_requests set status = 'approved', updated_at = now() where id = p_id;
  -- ★D9: 근무를 넘겨받은 사람(대타 · 맞교환 상대)에게 알린다. 요청자는 앱이 바로 알린다(notifyUserSwapResult).
  perform public.put_schedule_notice(s.unit_id, s.accepted_by, 'swap_confirmed',
    case when s.kind = 'swap' then '맞교환이 확정됐어요' else '대타 근무가 확정됐어요' end,
    case
      when s.kind = 'swap' and s.target_date is not null
        then format('%s 근무를 받고 %s 근무를 넘겼어요', public.schedule_notice_day(s.date::date), public.schedule_notice_day(s.target_date::date))
      when s.part_start is not null and s.part_end is not null
        then format('%s %s~%s 근무를 맡게 됐어요', public.schedule_notice_day(s.date::date), s.part_start, s.part_end)
      else format('%s 근무를 맡게 됐어요', public.schedule_notice_day(s.date::date))
    end);
  return true;
end $$;
revoke all on function public.approve_swap(text, boolean) from public, anon, authenticated;
grant execute on function public.approve_swap(text, boolean) to authenticated;

-- ── ④ decide_shift_time (0279 본문 그대로 + 결과 알림) ──────────────────────
create or replace function public.decide_shift_time(
  p_id text, p_approve boolean, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  r      record;
  t      record;
  v_day  text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_approve is null then raise exception 'invalid_decision'; end if;
  -- 잠그고 다시 본다: 두 기기가 동시에 승인해도 두 번째는 not_pending(데이터 M2).
  select * into r from public.shift_change_requests where id = p_id for update;
  if not found or r.unit_id is distinct from v_unit or r.archived_tenure_id is not null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  if not p_approve then
    update public.shift_change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    -- ★D9: 요청한 직원에게 결과를 알린다.
    perform public.put_schedule_notice(r.unit_id, r.staff_id, 'shift_time_result', '근무 시간 수정이 반려됐어요',
      format('%s 근무는 그대로예요', public.schedule_notice_day(r.date)));
    return true;
  end if;

  -- 교대 승인(approve_swap 0242)과 같은 창: 35일이 넘은 근무는 승인하지 않는다. 지난 근무는 경고를 거친 뒤에만(Q4).
  if r.date < public.kst_today() - 35 then raise exception 'too_old'; end if;
  if r.date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  -- 요청 뒤 그날 근무가 빠졌거나(예외 · 기간 · 날짜) 담당자가 바뀌었으면 승인하지 않고 요청을 닫는다.
  select * into t from public.shift_templates where id = r.template_id for update;
  if not found or t.unit_id is distinct from r.unit_id or t.staff_id is distinct from r.staff_id
     or t.archived_tenure_id is not null
     or (case when t.shift_date is not null then t.shift_date <> r.date
              else t.weekday <> extract(dow from r.date)::int
                   or r.date < t.valid_from
                   or (t.valid_to is not null and r.date > t.valid_to)
                   or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = r.date)
         end) then
    update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return false;
  end if;

  -- "이 날만" 규칙을 그대로 쓴다(반복 = 그날 예외 + 날짜 지정 행 · 날짜 지정 = 그 행의 시각).
  v_day := public.override_shift_day(r.template_id, r.date, r.new_start, r.new_end, p_confirm_past);
  update public.shift_templates set edited_by = 'staff' where id = v_day;   -- 사장 화면 "직원 수정"(0178 약속)
  update public.shift_change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  -- ★D9: 요청한 직원에게 결과를 알린다.
  perform public.put_schedule_notice(r.unit_id, r.staff_id, 'shift_time_result', '근무 시간 수정이 승인됐어요',
    format('%s 근무가 %s~%s로 바뀌었어요', public.schedule_notice_day(r.date), r.new_start, r.new_end));
  return true;
end $$;
revoke all on function public.decide_shift_time(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.decide_shift_time(text, boolean, boolean) to authenticated;

-- ── ⑤ notify_shift_changed — 사장 · 매니저의 근무 편집 뒤 앱이 부른다 ─────────
create or replace function public.notify_shift_changed(p_staff text, p_date date, p_onward boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null or v_unit is null or not public.auth_can_manage() then return false; end if;
  if p_date is null or p_staff is null then return false; end if;
  -- 이 매장 멤버에게만(헬퍼도 보지만 호출 입구에서 먼저 막는다).
  if not exists (select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id::text = p_staff) then
    return false;
  end if;
  return public.put_schedule_notice(v_unit, p_staff, 'shift_changed', '근무표가 바뀌었어요',
    format(case when coalesce(p_onward, false) then '%s부터 근무를 확인해 주세요' else '%s 근무를 확인해 주세요' end,
           public.schedule_notice_day(p_date)));
end $$;
revoke all on function public.notify_shift_changed(text, date, boolean) from public, anon, authenticated;
grant execute on function public.notify_shift_changed(text, date, boolean) to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if (select p.prosrc from pg_proc p where p.oid = 'public.approve_swap(text, boolean)'::regprocedure) not like '%put_schedule_notice%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.approve_swap(text, boolean)'::regprocedure) not like '%transfer_shift%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.decide_shift_time(text, boolean, boolean)'::regprocedure) not like '%put_schedule_notice%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.decide_shift_time(text, boolean, boolean)'::regprocedure) not like '%too_old%' then
    raise exception '0289 자가점검 실패 — 승인 · 결정 본문이 어긋났다';
  end if;
  if has_function_privilege('authenticated', 'public.put_schedule_notice(text, text, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.notify_shift_changed(text, date, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.notify_shift_changed(text, date, boolean)', 'execute') then
    raise exception '0289 자가점검 실패 — 권한이 어긋났다';
  end if;
  raise notice '0289 자가점검 통과';
end $$;
