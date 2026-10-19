-- 0322 클라 주장 신뢰 근본 수정 ④ — 출퇴근 (2026-10-19 지시서 §3-10 · 사용자 결정 (나) + 10-20 (가) 기한 없음)
--
-- 결정: 직원은 자기 출퇴근 기록을 고칠 수 있다. 고친 흔적은 위조할 수 없고 사장에게 반드시 보인다. 고칠 수 있는 기한은 두지 않는다.
-- 남아 있던 구멍: edited_by·work_minutes 를 앱이 정했다 → 직원이 고치고 'owner'(사장 수정)로 적거나 표시를 지우고, 근무 분을 부풀릴 수 있었다.
-- 해법(앱이 테이블에 직접 쓸 때만 · 정의자 RPC 경로는 그 함수가 판정한다):
--   · 근무 분은 서버가 출퇴근 시각으로 센다(앱 minutesBetween 과 같은 식: 반올림 · 0 이상 · 24시간 상한).
--   · 직원 쓰기 중 '지금 시각' 출근·퇴근 버튼만 수정이 아니다. 그 밖은 모두 edited_by='staff'.
--   · 'staff' 표시는 직원이 지울 수 없다(관리자가 고치면 'owner' 로 바뀌지만 이력은 남는다).
--   · 모든 수정·삭제는 attendance_edits 에 고치기 전 값과 함께 남는다. 관리자만 읽고, 아무도 고치거나 지울 수 없다.
-- 옛 앱 호환: 출근·퇴근 버튼(now)과 수동 보정(edited_by 'staff'/'owner')을 보내는 모양 그대로 통과한다. 위조한 값만 바뀐다.

create table if not exists public.attendance_edits (
  id             bigserial primary key,
  attendance_id  text not null,
  unit_id        text not null,
  staff_id       text not null,
  edited_by_uid  uuid not null,
  edited_role    text not null check (edited_role in ('staff', 'owner')),
  action         text not null check (action in ('insert', 'update', 'delete')),
  old_check_in   timestamptz,
  old_check_out  timestamptz,
  new_check_in   timestamptz,
  new_check_out  timestamptz,
  edited_at      timestamptz not null default now()
);
create index if not exists attendance_edits_unit_idx on public.attendance_edits (unit_id, edited_at desc);
create index if not exists attendance_edits_att_idx on public.attendance_edits (attendance_id);
alter table public.attendance_edits enable row level security;
revoke all on public.attendance_edits from anon, authenticated;
grant select on public.attendance_edits to authenticated;
drop policy if exists ae_select on public.attendance_edits;
create policy ae_select on public.attendance_edits for select to authenticated
  using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

create or replace function public.attendance_log_edit(p_att text, p_unit text, p_staff text, p_role text, p_action text,
  p_oin timestamptz, p_oout timestamptz, p_nin timestamptz, p_nout timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 아래 트리거 안에서만 적는다. 직원이 직접 불러 가짜 이력을 만들 수 없다.
  if pg_trigger_depth() < 1 then raise exception 'attendance_log_edit_trigger_only' using errcode = '42501'; end if;
  insert into public.attendance_edits (attendance_id, unit_id, staff_id, edited_by_uid, edited_role, action, old_check_in, old_check_out, new_check_in, new_check_out)
  values (p_att, p_unit, p_staff, auth.uid(), p_role, p_action, p_oin, p_oout, p_nin, p_nout);
end $$;
-- 트리거가 직원 권한(SECURITY INVOKER)으로 부르므로 실행 권한은 연다. 직접 호출은 위 검사가 막는다.
revoke execute on function public.attendance_log_edit(text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.attendance_log_edit(text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

-- '지금 시각' 판정 폭. 기기 시계가 조금 틀려도 버튼은 버튼으로 본다.
create or replace function public.attendance_is_now(p_at timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_at is not null and p_at between now() - interval '10 minutes' and now() + interval '10 minutes'
$$;

create or replace function public.attendance_staff_edit_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_manage boolean;
  v_punch  boolean;
  v_role   text;
begin
  if current_user <> 'authenticated' or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_manage := public.auth_can_manage();
  v_role := case when v_manage then 'owner' else 'staff' end;

  -- ★이력은 여기서 적지 않는다. 앱의 퇴근은 upsert(INSERT … ON CONFLICT DO UPDATE)라 충돌 판정 전에
  --   BEFORE INSERT 가 먼저 돈다 — 여기서 적으면 정상 퇴근마다 가짜 '직접 추가' 이력이 남는다(검증 10-20).
  --   실제로 반영된 쓰기만 AFTER 트리거(attendance_log_after)가 적는다.
  if tg_op = 'DELETE' then return old; end if;

  -- 근무 분은 서버가 센다.
  new.work_minutes := case when new.check_in is not null and new.check_out is not null
    then least(24 * 60, greatest(0, round(extract(epoch from (new.check_out - new.check_in)) / 60)::int)) else 0 end;

  if tg_op = 'INSERT' then
    -- 출근 버튼: 지금 출근 · 퇴근 없음.
    v_punch := public.attendance_is_now(new.check_in) and new.check_out is null;
    if v_punch and not v_manage then
      new.edited_by := null;
      return new;
    end if;
    if not v_manage or new.edited_by is not null then new.edited_by := v_role; end if;
    return new;
  end if;

  -- UPDATE
  if not public.attendance_times_edited(old.check_in, old.check_out, new.check_in, new.check_out, v_manage) then
    -- 시각이 그대로거나 퇴근 버튼이면 표시도 그대로(직원은 'staff' 를 지울 수 없다 · 사장 표시를 사칭할 수 없다).
    new.edited_by := old.edited_by;
    return new;
  end if;
  new.edited_by := v_role;
  return new;
end $$;

-- 수정으로 볼 시각 변경인가: 시각이 바뀌었고, 직원의 퇴근 버튼(출근 그대로 · 열린 기록을 지금 닫음)이 아니다.
create or replace function public.attendance_times_edited(p_oin timestamptz, p_oout timestamptz, p_nin timestamptz, p_nout timestamptz, p_manage boolean)
returns boolean language sql stable set search_path = public as $$
  select (p_nin is distinct from p_oin or p_nout is distinct from p_oout)
     and not (not p_manage and p_nin is not distinct from p_oin and p_oout is null and public.attendance_is_now(p_nout))
$$;

-- 이력은 실제로 반영된 쓰기만 적는다(AFTER). upsert 의 INSERT 단계가 충돌로 UPDATE 가 되면 AFTER INSERT 는 돌지 않는다.
create or replace function public.attendance_log_after()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_manage boolean; v_role text;
begin
  if current_user <> 'authenticated' or auth.uid() is null then return null; end if;
  v_manage := public.auth_can_manage();
  v_role := case when v_manage then 'owner' else 'staff' end;
  if tg_op = 'INSERT' then
    -- 출근 버튼(edited_by null)은 수정이 아니다.
    if new.edited_by is not null then
      perform public.attendance_log_edit(new.id, new.unit_id, new.staff_id, v_role, 'insert', null, null, new.check_in, new.check_out);
    end if;
  elsif tg_op = 'UPDATE' then
    if public.attendance_times_edited(old.check_in, old.check_out, new.check_in, new.check_out, v_manage) then
      perform public.attendance_log_edit(old.id, old.unit_id, old.staff_id, v_role, 'update', old.check_in, old.check_out, new.check_in, new.check_out);
    end if;
  else
    perform public.attendance_log_edit(old.id, old.unit_id, old.staff_id, v_role, 'delete', old.check_in, old.check_out, null, null);
  end if;
  return null;
end $$;

drop trigger if exists trg_attendance_staff_edit_guard on public.attendance;
create trigger trg_attendance_staff_edit_guard before insert or update or delete on public.attendance
  for each row execute function public.attendance_staff_edit_guard();
drop trigger if exists trg_attendance_log_after on public.attendance;
create trigger trg_attendance_log_after after insert or update or delete on public.attendance
  for each row execute function public.attendance_log_after();
