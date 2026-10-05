-- 0279 — 지난달 날짜 하나 고치기 허용 (A1·A2 · 2026-10-06 사장님 결정)
--
-- 결정(논리점검_결정기록_2026-10-06.md §1): 0242 의 "지난달은 어떤 경우에도 안 바뀐다"는 반복 근무의 소급을 막는 뜻이었다.
--   · 반복 근무 변경은 지금처럼 바꾼 날부터 이후에만 적용한다(소급 금지 유지).
--     add_shift_series · edit_shift_from · end_shift_from 의 past_month_locked(0242·0246)는 그대로 둔다.
--     옛 앱의 반복 행 직접 수정·삭제는 trg_shift_series_guard(0242)가 지난 구간을 복사본으로 남긴다. 그대로 둔다.
--   · 특정 날짜 하나를 고치는 일은 지난달이어도 된다. 대상은 대타 승인, 시간 수정 요청·승인, 근무 추가·삭제(예외), 되돌리기.
--
-- 바꾸는 것
--   ① trg_shift_past_month(shift_templates 날짜 지정 행) · trg_shift_exceptions_past_month(shift_exceptions) 트리거와
--      그 함수 shift_past_month_guard 를 내린다. 이 트리거는 날짜 지정 행과 예외만 봤다(반복 행은 보지 않았다).
--   ② approve_swap · override_shift_day · request_shift_time · decide_shift_time: 0246 본문 그대로, past_month_locked 줄만 뺀다.
--      35일 창(Q10 · approve_swap false · request_shift_time date_out_of_range · decide_shift_time too_old)과
--      지난 날짜 확인(Q4 · confirm_past_required)은 그대로다.
--
-- shift_month_start() 는 반복 근무 RPC 3개가 계속 쓴다. 권한(grant/revoke)은 0246 과 같다.
-- 되돌리기: 0242 의 shift_past_month_guard·트리거 2개와 0246 의 네 함수 본문을 다시 적용한다.

drop trigger if exists trg_shift_past_month on public.shift_templates;
drop trigger if exists trg_shift_exceptions_past_month on public.shift_exceptions;
drop function if exists public.shift_past_month_guard();

-- approve_swap (0246 본문 그대로 · 지난달 잠금 줄만 뺀다)
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
  return true;
end $$;
revoke all on function public.approve_swap(text, boolean) from public, anon, authenticated;
grant execute on function public.approve_swap(text, boolean) to authenticated;

-- override_shift_day (0246 본문 그대로 · 지난달 잠금 줄만 뺀다)
create or replace function public.override_shift_day(
  p_id text, p_date date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
  v_new  text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if (p_start is null) <> (p_end is null) then raise exception 'invalid_time'; end if;
  if p_start is not null and (p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                              or public.shift_span_min(p_start, p_end) = 0) then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null then raise exception 'not_found'; end if;
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
    if p_start is null then
      delete from public.shift_templates where id = p_id;
      v_new := null;
    else
      update public.shift_templates set start_time = p_start, end_time = p_end where id = p_id;
      v_new := p_id;
    end if;
  else
    if t.weekday <> extract(dow from p_date)::int or p_date < t.valid_from
       or (t.valid_to is not null and p_date > t.valid_to)
       or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
      raise exception 'day_not_scheduled';
    end if;
    -- 그날의 미결 교대는 더 이상 성사될 수 없다(그날 반복이 빠진다).
    delete from public.swap_requests
     where status in ('open', 'accepted')
       and ((template_id = p_id and date = to_char(p_date, 'YYYY-MM-DD'))
         or (target_template_id = p_id and target_date = to_char(p_date, 'YYYY-MM-DD')));
    insert into public.shift_exceptions(template_id, unit_id, date) values (t.id, t.unit_id, p_date);
    if p_start is null then
      v_new := null;
    else
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values (v_new, t.unit_id, t.staff_id, null, p_date, p_start, p_end);
    end if;
  end if;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return v_new;
end $$;
revoke all on function public.override_shift_day(text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.override_shift_day(text, date, text, text, boolean) to authenticated;

-- request_shift_time (0246 본문 그대로 · 지난달 잠금 줄만 뺀다)
create or replace function public.request_shift_time(
  p_template text, p_date date, p_start text, p_end text, p_note text default null
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
  v_id   text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or public.shift_span_min(p_start, p_end) = 0 then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_template;
  if not found or v_unit is null or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null
     or not exists (select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id = auth.uid()) then
    raise exception 'not_found';
  end if;
  if t.staff_id is distinct from auth.uid()::text then raise exception 'not_own_shift'; end if;
  if p_date < public.kst_today() - 35 or p_date > public.kst_today() + 60 then raise exception 'date_out_of_range'; end if;
  -- 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음)
  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
  elsif t.weekday <> extract(dow from p_date)::int
     or p_date < t.valid_from
     or (t.valid_to is not null and p_date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
    raise exception 'day_not_scheduled';
  end if;

  -- 같은 근무·같은 날의 앞 대기 요청은 닫고 새 id 로 낸다. 같은 id 의 시각을 고치면 사장이 화면에서 본 시각이 아니라
  -- 고친 시각이 승인된다. 앞 id 로 승인하면 not_pending 이 난다.
  update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where template_id = t.id and date = p_date and status = 'pending';
  insert into public.shift_change_requests(unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end, note)
    values (t.unit_id, auth.uid()::text, t.id, p_date, t.start_time, t.end_time, p_start, p_end,
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_shift_time(text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.request_shift_time(text, date, text, text, text) to authenticated;

-- decide_shift_time (0246 본문 그대로 · 지난달 잠금 줄만 뺀다)
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
  return true;
end $$;
revoke all on function public.decide_shift_time(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.decide_shift_time(text, boolean, boolean) to authenticated;
