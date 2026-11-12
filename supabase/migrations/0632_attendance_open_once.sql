-- 0632_attendance_open_once.sql — 열린 출근 하나 · 퇴근과 시간 수정은 열 단위로 (결함 전수 점검 S2 · M1·M2 · 2026-11-12)
--
-- M1 결함(S0 실측 RED 10/10): 두 기기에서 동시에 출근하면 열린 기록(check_out null)이 2개 생긴다.
--   앱의 막기는 메모리 records 만 본다(useAttendanceStore checkIn · findOpenRecord). 근무 분이 부풀어 근무 기록이 틀린다.
-- M2 결함(S0 실측 RED 4~5/10): 퇴근과 관리자 시간 수정이 둘 다 행 전체 upsert 라 늦게 온 쪽이 앞 변경을 지운다.
-- 고침:
--   ① 부분 unique attendance_one_open_uq (unit_id, staff_id) where check_out is null and archived_tenure_id is null.
--      라이브 겹친 행 0(S0 9절 · 11-12 이 세션이 다시 셈 0). 보관된 옛 기록(재입사 전)은 빼서 다시 들어온 직원이 출근할 수 있다.
--      옛 앱의 둘째 기기 upsert 는 23505 로 진다. 앱은 writeStrict(boolean)라 화면에는 "출근 기록 저장에 실패했어요" 만 나오고
--      원문은 계측(reportError)으로만 간다. 열린 기록은 realtime 으로 둘째 기기에 온다.
--   ② attendance_check_in  = 출근. unique 에 지면 already 와 열린 기록 id(같은 id 재시도도 already).
--   ③ attendance_check_out = 퇴근. check_out 만 쓴다(where check_out is null). 근무 분은 0322 트리거가 그 행의 최신 출근 시각으로 센다.
--   ④ attendance_edit_times = 시간 수정. 넘긴 열만 쓴다(null = 그대로). 퇴근을 지우는(다시 여는) 수정은 이 함수로 하지 않는다.
--   셋 다 SECURITY INVOKER 다. RLS(attendance_* 정책)와 0322 트리거(작성 표시 · 근무 분 · attendance_edits 이력)를 그대로 탄다.
--   정의자로 만들면 0322 트리거가 current_user 판정으로 건너뛰어 이력이 안 남는다.
--
-- 옛 앱 호환: 안전 | 옛 앱의 upsertAttendance(행 통째 upsert)·deleteAttendance 는 그대로 돈다. 바뀌는 것은 같은 직원의 열린 기록 둘째 줄이
--   23505 로 거절되는 것뿐이다(지금도 앱이 막으려던 상태 · 실패 문구로 보인다). 옛 통째 upsert 의 M2 덮어쓰기는 옛 앱이 사라질 때까지 남는다.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0632.sql

create unique index if not exists attendance_one_open_uq
  on public.attendance (unit_id, staff_id)
  where check_out is null and archived_tenure_id is null;

create or replace function public.attendance_check_in(p_id text, p_date text)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_uid  text := auth.uid()::text;
  v_unit text := public.auth_unit_id();
  v_open text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  if coalesce(btrim(p_id), '') = '' or length(p_id) > 120 or coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invalid_argument';
  end if;
  begin
    insert into public.attendance (id, unit_id, staff_id, date, check_in, check_out, work_minutes)
    values (p_id, v_unit, v_uid, p_date, now(), null, 0);
  exception when unique_violation then
    -- 열린 기록이 이미 있다(다른 기기 · 같은 요청 재시도). 그 id 를 돌려준다.
    select a.id into v_open from public.attendance a
     where a.unit_id = v_unit and a.staff_id = v_uid and a.check_out is null and a.archived_tenure_id is null
     limit 1;
    if v_open is null then raise exception 'invalid_argument'; end if;   -- id 가 다른 사람·닫힌 기록과 겹침
    return jsonb_build_object('status', 'already', 'id', v_open);
  end;
  return jsonb_build_object('status', 'ok', 'id', p_id);
end $$;
comment on function public.attendance_check_in(text, text) is
  '0632 출근(지금 시각 · 내 기록). {status: ok|already, id}. 열린 기록은 (매장, 직원)당 하나(attendance_one_open_uq).';
revoke all on function public.attendance_check_in(text, text) from public, anon;
grant execute on function public.attendance_check_in(text, text) to authenticated;

create or replace function public.attendance_check_out(p_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_uid  text := auth.uid()::text;
  v_unit text := public.auth_unit_id();
  v_id   text;
  r      public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  -- 내 열린 기록(날짜 무관 · 야간 근무 F2). p_id 를 주면 그 기록만.
  select a.id into v_id from public.attendance a
   where a.unit_id = v_unit and a.staff_id = v_uid and a.check_out is null and a.archived_tenure_id is null
     and (p_id is null or a.id = p_id)
   order by a.check_in desc nulls last
   limit 1;
  if v_id is null then return jsonb_build_object('status', 'already'); end if;
  -- race: 조건부 update(check_out is null)가 한 번만 닫는다. 진 쪽은 0행 → already.
  update public.attendance a set check_out = now()
   where a.id = v_id and a.check_out is null
  returning * into r;
  if not found then return jsonb_build_object('status', 'already'); end if;
  return jsonb_build_object('status', 'ok', 'id', r.id, 'check_out', r.check_out, 'work_minutes', r.work_minutes);
end $$;
comment on function public.attendance_check_out(text) is
  '0632 퇴근(지금 시각 · 내 열린 기록). check_out 만 쓴다. {status: ok|already, id?, check_out?, work_minutes?}';
revoke all on function public.attendance_check_out(text) from public, anon;
grant execute on function public.attendance_check_out(text) to authenticated;

create or replace function public.attendance_edit_times(p_id text, p_check_in timestamptz default null, p_check_out timestamptz default null)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare r public.attendance%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(btrim(p_id), '') = '' or (p_check_in is null and p_check_out is null) then raise exception 'invalid_argument'; end if;
  -- 넘긴 열만 쓴다. 고친 사람 표시(edited_by)·근무 분·이력은 0322 트리거가 정한다. 권한은 attendance_update 정책(관리자 또는 본인).
  update public.attendance a
     set check_in  = coalesce(p_check_in, a.check_in),
         check_out = coalesce(p_check_out, a.check_out)
   where a.id = p_id
  returning * into r;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('status', 'ok', 'id', r.id, 'check_in', r.check_in, 'check_out', r.check_out,
                            'work_minutes', r.work_minutes, 'edited_by', r.edited_by);
end $$;
comment on function public.attendance_edit_times(text, timestamptz, timestamptz) is
  '0632 출퇴근 시간 수정(넘긴 열만 · null = 그대로). {status: ok, id, check_in, check_out, work_minutes, edited_by} · not_found · invalid_argument';
revoke all on function public.attendance_edit_times(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.attendance_edit_times(text, timestamptz, timestamptz) to authenticated;

do $$
begin
  if exists (select 1 from pg_proc where proname in ('attendance_check_in', 'attendance_check_out', 'attendance_edit_times')
               and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '0632: 출퇴근 함수가 정의자다 — 0322 트리거가 건너뛴다';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'attendance_one_open_uq') then
    raise exception '0632: attendance_one_open_uq 가 없다';
  end if;
end $$;
