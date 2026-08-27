-- 0185 — 허브 '이번달 인건비'의 **입력**을 근무표 기준으로 준다 (급여 기준 = 근무표, 2026-08-26 확정)
--
-- 왜 필요한가(★안 하면 두 화면이 다른 돈을 말한다):
--   허브 현황의 인건비는 owner_overview.labor_month(0060→0091) = **출퇴근 기록 × 시급**이다.
--   직원 관리(owner/staff)는 0176~0180 이후 **근무표 × computePay**(주휴·야간·휴게 반영)다.
--   같은 매장·같은 달인데 허브 146만 / 직원 관리 322만으로 갈렸다(2026-08-27 실측).
--
-- 왜 서버에서 금액을 계산하지 않나(★규칙 SSOT 한 곳):
--   주휴·야간·휴게·30분 절삭 규칙의 정본은 `src/lib/utils/payroll.ts#computePay` 하나다.
--   SQL 로 다시 쓰면 규칙이 두 벌이 되고 한쪽만 고친 날 금액이 다시 갈린다. 그래서 이 함수는
--   **원자료만** 돌려주고(근무표·예외·시급·급여 규칙·직원 목록) 금액은 클라이언트가 직원 관리와
--   **같은 함수**로 계산한다.
--
-- 왜 RPC 인가: 근무표·시급·units 의 RLS 는 전부 `auth_unit_id()`(활성 매장) 스코프다 — 허브는
--   교차 매장이라 클라가 직접 읽을 수 없다(owner_overview·owner_today 와 같은 사유, definer).
--
-- 노출 범위: 소유 매장(units.owner_id = auth.uid())만. 직원·매니저는 0행(자기 매장도 안 나온다 —
--   허브 현황 탭 자체가 사장 전용이다).
--
-- ★owner_overview.labor_month 는 그대로 둔다(반환 타입 변경 = drop 필요·소비처 3곳). 허브 화면은
--   더 이상 그 칸을 읽지 않는다 — 이 함수가 유일한 인건비 원장이다(OwnerStatusView 참고).

create or replace function public.owner_labor_inputs()
returns table(
  unit_id          text,
  staff_ids        jsonb,  -- ["uuid", …] 현재 직원(profiles.role='junior', 미삭제) — owner_overview 의 staff 술어와 동일
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end}] 근무표 전량(0138: 요일 반복 or 날짜 지정)
  exceptions       jsonb,  -- [{template_id, date}] 그날 빠진 반복(0178)
  wages            jsonb,  -- {staff_id: hourly_wage} — 행 없음 = 시급 미설정(클라가 0원으로 대신 계산하지 않는다, #38)
  payroll_settings jsonb   -- units.payroll_settings(0054) 그대로. null = 기본 규칙
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

revoke all on function public.owner_labor_inputs() from public, anon;
grant execute on function public.owner_labor_inputs() to authenticated;

-- ── 자가점검 — 예외(0178)를 안 보면 교대한 날 근무가 두 벌로 잡혀 돈이 부푼다 ──
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.owner_labor_inputs()'::regprocedure);
  if position('shift_exceptions' in v_def) = 0 then raise exception '0185 자가점검 실패: owner_labor_inputs 가 shift_exceptions 를 안 본다'; end if;
  if position('owner_id = auth.uid()' in v_def) = 0 then raise exception '0185 자가점검 실패: 소유 매장 게이트 누락'; end if;
end $$;
