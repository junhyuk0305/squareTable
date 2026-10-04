-- 0245 — 결근 표시 shift_day_marks (J1-c · §8 Q4 · 데이터 검토 H6)
--
-- 사용자 결정(J1): 지난 것은 그대로, 앞으로만 바뀐다. 급여 기준은 근무표다(08-26). 결근은 날마다 손으로 빼지 않고
--   "근무표에는 있는데 출근 기록이 없는 날" 목록(앱 C)에서 사장이 한 번 누른다([결근 처리] / [근무 인정]).
--   사장이 아무것도 안 하면 근무표대로 지급한다(직원이 덜 받는 쪽으로 틀리지 않는 기본값).
-- 사용자 결정(§8 Q4): 지난 날짜의 결근 표시는 그 기간 급여를 바꾼다 → 서버는 p_confirm_past 를 요구하고
--   앱이 "지난 기간이에요. 그 기간 급여가 바뀌어요." 경고창을 띄운다.
--
-- 무엇이 문제였나
--   결근을 남길 곳이 없었다. shift_exceptions 를 쓰면 근무표 화면에 "교대로 넘긴 흔적"으로 잘못 보이고(owner/schedule.tsx)
--   날짜 지정 행에는 걸 수도 없다(설계 01 §2).
--   데이터 H6: 표시가 근무 행(template_id)에 붙는데, 반복 근무를 고치면 나누기(copy_past_segment)가 예외·교대·요청만
--   지난 구간 복사본으로 옮긴다. 지난 날짜의 결근 표시가 "오늘부터" 행에 남으면 그 날짜에는 적용되지 않으므로
--   결근이 사라지고 지난 급여가 다시 늘어난다.
--
-- 바꾸는 것
--   ① 표 shift_day_marks(template_id fk cascade, date, unit_id, staff_id, mark in ('absent','worked'), marked_by, marked_at).
--      기본키 (template_id, date). RLS 읽기 = 같은 매장의 관리자 또는 본인(직원 기록 화면 "결근 처리됨" · 분쟁 예방).
--      쓰기 정책은 없다(RPC 로만). realtime publication 에 넣는다(AGENTS ⑤).
--      staff_id 는 표시할 때의 담당자다. 나중에 교대로 그날 담당자가 바뀌면(approve_swap) 그 표시는 새 담당자에게
--      적용하지 않는다(앱 C 규칙: 표시의 staff_id 가 그날 근무 행 담당자와 같을 때만 뺀다).
--   ② mark_shift_day(근무, 날짜, 표시, p_confirm_past): auth_is_owner() 만(급여 영향 · 0201 원칙 · 매니저 불가) ·
--      활성 매장 근무만(IDOR) · 그날 실제로 서는 근무(날짜 지정은 그 날짜 · 반복은 요일·적용 기간·그날 예외 없음) ·
--      미래 날짜 거부 · 오늘보다 이른 날짜는 p_confirm_past 필수 · 같은 (근무, 날짜)는 덮어쓴다.
--      근무 행을 for share 로 잠가 동시에 도는 나누기(copy_past_segment)와 엇갈리지 않게 한다.
--   ③ clear_shift_day(근무, 날짜, p_confirm_past): 사장만 · 활성 매장 표시만 · 오늘보다 이른 날짜는 p_confirm_past.
--      다른 매장 표시나 없는 표시는 false(있는지 알려 주지 않는다).
--   ④ copy_past_segment(0243 본문 승계 + 한 줄): 지난 날짜 결근 표시도 지난 구간 복사본을 따라간다(데이터 H6).
--      split_shift_at(edit_shift_from) · 옛 앱 직접 UPDATE·DELETE(trg_shift_series_guard)가 모두 이 헬퍼를 지난다.
--   ⑤ owner_labor_inputs_v2 · my_cross_summary_v2(0242 본문 승계 + 두 열): marks(결근 표시) · wage_rates(시급 이력).
--      RLS(sdm_read · wage_rates_read)는 활성 매장만 보인다. 허브와 다매장 직원은 이 두 함수로만 다른 매장 몫을 받는다.
--      RLS 는 넓히지 않는다. 방어선은 0242 그대로(사장 = u.owner_id = auth.uid() · 직원 = 본인 멤버십 · 본인 표시·이력만).
--      앱 C 의 computePeriodPay 4곳(staff · TimesheetView · junior/attendance · useHubStore) 중 허브와 직원 합계가 이 열을 쓴다.
--
-- 바꾸지 않는 것(계획과 다른 점 · 코드가 맞다)
--   · end_shift_from(0242)은 다시 정의하지 않는다. 계획(데이터 H6)은 "표시가 있으면 지우지 말고 valid_to 로 닫는다"이다.
--     0242 는 이미 시작일 뒤부터 그만두면 valid_to 로 닫는다(표시는 그 행에 남는다 · qa:day-marks 2-9).
--     지우는 분기는 둘뿐이다. (가) 날짜 지정 행 (나) 시작일 이하부터 그만두는 반복 행. 둘 다 CHECK 때문에 닫을 수 없다
--     (날짜 지정 행은 valid_to 없음 · valid_to >= valid_from). 이때 표시가 붙은 날은 모두 그만두는 범위 안이라 근무가
--     없어진다. 그날 지급액은 표시가 있든 없든 0이다. 지난 날짜면 p_confirm_past 를 거친다(Q4).
--   · override_shift_day · transfer_shift 는 그대로다. 그날을 다른 행으로 바꾸면 원래 행의 그날 표시는 적용되지 않는다
--     (그날 그 행이 서지 않는다). 앱 C 는 "그날 서는 근무 행"의 표시만 본다.
--   · 직원 알림("결근 처리됨" 푸시)과 화면은 앱 C(P4-7).
--
-- 옛 앱 호환: 옛 앱은 이 표와 RPC 를 모른다. 결근일도 계속 지급액에 넣는다(지금과 같고 더 나빠지지 않는다).
--   옛 앱 사장의 반복 근무 직접 수정·삭제는 0242 트리거 그대로이고, 나누기는 이 표도 옮긴다(qa:day-marks [2]).
-- ★0246 이 이 표에 archived_tenure_id 를 단다(재입사 표시 · 마스터 계획 0246 상세 2).
-- 함수 담당표: copy_past_segment/split_shift_at 0242 → 0243 → 0245. 다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 함수 담당표(계획 §4 와 다른 점): owner_labor_inputs_v2 · my_cross_summary_v2 = 0242 → **0245** → 0246. 0246 이 archived_tenure_id
--   조건을 넣을 때 0242 가 아니라 이 파일 본문에서 시작하고, marks · wage_rates 집계에도 같은 조건을 붙인다(qa:definer-filters 가 두 토큰을 본다).
-- 되돌리기: scripts/rollback/0245.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① 표 + RLS + realtime
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.shift_day_marks (
  template_id text not null references public.shift_templates(id) on delete cascade,
  date        date not null,                                  -- 표시한 그날
  unit_id     text not null references public.units(id) on delete cascade,
  staff_id    text not null,                                  -- 표시할 때 그날 근무 담당자(shift_templates.staff_id)
  mark        text not null check (mark in ('absent', 'worked')),
  marked_by   uuid,                                           -- 표시한 사장
  marked_at   timestamptz not null default now(),
  primary key (template_id, date)
);
create index if not exists idx_sdm_unit_date on public.shift_day_marks(unit_id, date);

comment on table public.shift_day_marks is
  '결근 표시(J1-c · 0245). absent = 그날 급여에서 빠짐 · worked = 확인할 날 목록에서만 빠짐. 쓰기는 mark_shift_day · clear_shift_day 로만. '
  'staff_id 가 그날 근무 행 담당자와 다르면(교대로 넘어간 날) 적용하지 않는다.';

alter table public.shift_day_marks enable row level security;
revoke all on table public.shift_day_marks from public, anon, authenticated;
grant select on table public.shift_day_marks to authenticated;   -- 읽기만(realtime 포함). 쓰기는 정의자 RPC.

drop policy if exists sdm_read on public.shift_day_marks;
create policy sdm_read on public.shift_day_marks
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );

-- ★AGENTS ⑤ — 클라가 구독하는 테이블은 publication 멤버여야 한다.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_day_marks'
  ) then
    alter publication supabase_realtime add table public.shift_day_marks;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ② mark_shift_day — 사장만 · 활성 매장 근무 · 그날 서는 근무 · 미래 거부 · 지난 날짜는 p_confirm_past
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.mark_shift_day(
  p_template text, p_date date, p_mark text, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_mark is null or p_mark not in ('absent', 'worked') then raise exception 'invalid_mark'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  -- 나누기(edit_shift_from · 옛 앱 직접 수정)와 엇갈리지 않게 근무 행을 잠근다. 기다린 뒤에는 새 기간으로 다시 본다.
  select * into t from public.shift_templates where id = p_template for share;
  if not found or t.unit_id is distinct from v_unit then raise exception 'not_found'; end if;
  if p_date > public.kst_today() then raise exception 'future_date'; end if;
  -- 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음)
  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
  elsif t.weekday <> extract(dow from p_date)::int
     or p_date < t.valid_from
     or (t.valid_to is not null and p_date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
    raise exception 'day_not_scheduled';
  end if;
  -- ★Q4: 지난 날짜 표시는 그 기간 급여를 바꾼다 → 앱이 경고를 거친 뒤 p_confirm_past=true 로 다시 부른다.
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  insert into public.shift_day_marks(template_id, date, unit_id, staff_id, mark, marked_by, marked_at)
    values (t.id, p_date, t.unit_id, t.staff_id, p_mark, auth.uid(), now())
  on conflict (template_id, date) do update
    set mark = excluded.mark, staff_id = excluded.staff_id, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  return true;
end $$;
revoke all on function public.mark_shift_day(text, date, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_shift_day(text, date, text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ clear_shift_day — 사장만 · 활성 매장 표시만 · 지난 날짜는 p_confirm_past
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.clear_shift_day(
  p_template text, p_date date, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  -- 다른 매장 표시는 활성 매장 조건으로 걸러져 false 다(있는지 알려 주지 않는다).
  delete from public.shift_day_marks where template_id = p_template and date = p_date and unit_id = v_unit;
  return found;
end $$;
revoke all on function public.clear_shift_day(text, date, boolean) from public, anon, authenticated;
grant execute on function public.clear_shift_day(text, date, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ copy_past_segment (0243 본문 승계 + 결근 표시 옮기기 한 줄 · 데이터 H6)
-- ════════════════════════════════════════════════════════════════════════════
-- copy_past_segment — 반복 행의 [valid_from, p_cut-1] 구간을 새 id 복사본으로 남기고, 그 구간의 예외·교대를 옮긴다.
--   ★원래 행은 건드리지 않는다. 트리거(BEFORE)에서 부르므로 원래 행을 고치면 "already modified" 오류가 난다(데이터 H1).
--   나눌 것이 없으면(날짜 지정 행 · p_cut <= valid_from) null.
create or replace function public.copy_past_segment(p_id text, p_cut date)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  t      record;
  v_copy text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
  v_cut  text := to_char(p_cut, 'YYYY-MM-DD');
begin
  select * into t from public.shift_templates where id = p_id;
  if not found or t.shift_date is not null or p_cut is null or p_cut <= t.valid_from then return null; end if;
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time,
                                     created_at, edited_by, valid_from, valid_to)
    values (v_copy, t.unit_id, t.staff_id, t.weekday, null, t.start_time, t.end_time,
            t.created_at, t.edited_by, t.valid_from, least(coalesce(t.valid_to, p_cut - 1), p_cut - 1));
  -- 지난 날짜의 "그날 없음"과 교대 기록은 지난 구간을 따라간다(안 옮기면 cascade 로 사라지거나 엉뚱한 구간에 붙는다).
  update public.shift_exceptions set template_id = v_copy where template_id = p_id and date < p_cut;
  update public.swap_requests set template_id = v_copy where template_id = p_id and date < v_cut;
  update public.swap_requests set target_template_id = v_copy
   where target_template_id = p_id and target_date is not null and target_date < v_cut;
  -- ★0243: 지난 날짜 근무 시간 요청(대기 · 결정 이력)도 지난 구간을 따라간다(데이터 H6).
  update public.shift_change_requests set template_id = v_copy where template_id = p_id and date < p_cut;
  -- ★0245: 지난 날짜 결근 표시도 지난 구간을 따라간다(데이터 H6). 안 옮기면 그 날짜에 결근이 사라져 지난 급여가 늘어난다.
  update public.shift_day_marks set template_id = v_copy where template_id = p_id and date < p_cut;
  return v_copy;
end $$;
revoke all on function public.copy_past_segment(text, date) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ owner_labor_inputs_v2 · my_cross_summary_v2 (0242 본문 승계 + marks · wage_rates 두 열)
-- ════════════════════════════════════════════════════════════════════════════
-- 왜: sdm_read · wage_rates_read(0244)는 활성 매장 행만 보인다. 허브(useHubStore)는 사장의 모든 매장 인건비를,
--   다매장 직원은 모든 소속 매장 합계를 한 번에 센다. 활성 매장이 아닌 매장의 결근일·시급 이력을 받을 길이 없으면
--   그 매장 결근일이 허브 인건비와 직원 합계에 그대로 남는다(매장 화면보다 크게 나온다).
--   RLS 는 넓히지 않는다. 이 두 정의자 함수가 그 길이다. 방어선은 0242 그대로다(사장 = u.owner_id · 직원 = 본인 멤버십).
-- 반환 열이 늘어 create or replace 로는 못 바꾼다 → drop 뒤 다시 만든다. 앱은 아직 _v2 를 부르지 않는다(앱 C 가 처음 부른다).
-- 옛 앱용 v1(owner_labor_inputs · my_cross_summary)은 그대로다(옛 앱은 표시·이력을 모른다).
drop function if exists public.my_cross_summary_v2();
create function public.my_cross_summary_v2()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions    jsonb,
  month_minutes bigint,
  hourly_wage   int,
  marks         jsonb,   -- ★0245: [{template_id, date, staff_id, mark}] 본인 결근 표시(표시의 staff_id = 본인)
  wage_rates    jsonb    -- ★0245: [{staff_id, effective_from, hourly_wage}] 본인 시급 이력
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and a.staff_id = auth.uid()::text
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', dm.template_id, 'date', to_char(dm.date, 'YYYY-MM-DD'),
                                          'staff_id', dm.staff_id, 'mark', dm.mark)
             order by dm.date, dm.template_id)
      from public.shift_day_marks dm
      where dm.unit_id = u.id and dm.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id and wr.staff_id = auth.uid()::text
    ), '[]'::jsonb)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
revoke all on function public.my_cross_summary_v2() from public, anon, authenticated;
grant execute on function public.my_cross_summary_v2() to authenticated;

drop function if exists public.owner_labor_inputs_v2();
create function public.owner_labor_inputs_v2()
returns table(
  unit_id          text,
  staff_ids        jsonb,
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end, valid_from, valid_to}]
  exceptions       jsonb,
  wages            jsonb,
  payroll_settings jsonb,
  marks            jsonb,  -- ★0245: [{template_id, date, staff_id, mark}] 그 매장 결근 표시 전부
  wage_rates       jsonb   -- ★0245: [{staff_id, effective_from, hourly_wage}] 그 매장 시급 이력 전부
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
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
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
    u.payroll_settings,
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', dm.template_id, 'date', to_char(dm.date, 'YYYY-MM-DD'),
                                          'staff_id', dm.staff_id, 'mark', dm.mark)
             order by dm.date, dm.template_id)
      from public.shift_day_marks dm
      where dm.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.staff_id, wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id
    ), '[]'::jsonb)
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs_v2() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs_v2() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 자가점검 — 표 · 정책 · realtime · 본문 · 권한
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  r     record;
begin
  -- 표: RLS · 권한(anon 없음 · authenticated 읽기만) · 정책 · 기본키 · realtime
  if not (select relrowsecurity from pg_class where oid = 'public.shift_day_marks'::regclass) then
    v_bad := v_bad || 'shift_day_marks(RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.shift_day_marks', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'shift_day_marks(anon 권한 남음) ';
  end if;
  if has_table_privilege('authenticated', 'public.shift_day_marks', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'shift_day_marks(authenticated 쓰기 권한 남음) ';
  end if;
  if not has_table_privilege('authenticated', 'public.shift_day_marks', 'SELECT') then
    v_bad := v_bad || 'shift_day_marks(authenticated 읽기 없음 — realtime·화면이 죽는다) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shift_day_marks') <> 1
     or position('auth_can_manage' in coalesce((select qual from pg_policies where schemaname = 'public'
                   and tablename = 'shift_day_marks' and policyname = 'sdm_read' and cmd = 'SELECT'), '')) = 0 then
    v_bad := v_bad || 'shift_day_marks(정책은 sdm_read 하나 · 관리자 또는 본인) ';
  end if;
  if position('(template_id, date)' in coalesce((select pg_get_constraintdef(oid) from pg_constraint
                where conrelid = 'public.shift_day_marks'::regclass and contype = 'p'), '')) = 0 then
    v_bad := v_bad || 'shift_day_marks(기본키가 (template_id, date) 가 아님) ';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'shift_day_marks') then
    v_bad := v_bad || '(realtime publication 에 없음) ';
  end if;

  -- 본문: 나누기가 넷 다 옮긴다(0243 요청 줄이 사라지지 않았는지 포함)
  v_def := pg_get_functiondef('public.copy_past_segment(text, date)'::regprocedure);
  if position('shift_day_marks' in v_def) = 0 or position('shift_change_requests' in v_def) = 0
     or position('shift_exceptions' in v_def) = 0 or position('swap_requests' in v_def) = 0 then
    v_bad := v_bad || 'copy_past_segment(예외·교대·요청·결근 표시 중 안 옮기는 것이 있음 — 데이터 H6) ';
  end if;
  foreach fn in array array['public.mark_shift_day(text, date, text, boolean)', 'public.clear_shift_day(text, date, boolean)'] loop
    v_def := pg_get_functiondef(fn::regprocedure);
    if position('auth_is_owner' in v_def) = 0 or position('auth_can_manage' in v_def) > 0 then
      v_bad := v_bad || fn || '(사장만이 아님 — 0201) ';
    end if;
    if position('auth_unit_id' in v_def) = 0 or position('p_confirm_past' in v_def) = 0 then
      v_bad := v_bad || fn || '(활성 매장·지난 날짜 확인 중 빠짐) ';
    end if;
  end loop;
  v_def := pg_get_functiondef('public.mark_shift_day(text, date, text, boolean)'::regprocedure);
  if position('valid_from' in v_def) = 0 or position('shift_exceptions' in v_def) = 0 or position('future_date' in v_def) = 0 then
    v_bad := v_bad || 'mark_shift_day(그날 적용 여부·미래 거부 중 빠짐) ';
  end if;
  -- _v2 둘: 표시·시급 이력을 주고, 0242 방어선(소유 매장 · 본인 멤버십)과 적용 기간이 그대로다.
  v_def := pg_get_functiondef('public.owner_labor_inputs_v2()'::regprocedure);
  if position('shift_day_marks' in v_def) = 0 or position('wage_rates' in v_def) = 0
     or position('owner_id = auth.uid()' in v_def) = 0 or position('valid_to' in v_def) = 0 then
    v_bad := v_bad || 'owner_labor_inputs_v2(표시·시급 이력·소유 매장 방어선·기간 중 빠짐) ';
  end if;
  v_def := pg_get_functiondef('public.my_cross_summary_v2()'::regprocedure);
  if position('shift_day_marks' in v_def) = 0 or position('wage_rates' in v_def) = 0
     or position('m.user_id = auth.uid()' in v_def) = 0 or position('dm.staff_id = auth.uid()' in v_def) = 0 then
    v_bad := v_bad || 'my_cross_summary_v2(표시·시급 이력·본인 멤버십·본인 표시만 중 빠짐) ';
  end if;
  foreach fn in array array['public.owner_labor_inputs_v2()', 'public.my_cross_summary_v2()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행 불가) '; end if;
  end loop;

  -- 권한
  foreach fn in array array['public.mark_shift_day(text, date, text, boolean)', 'public.clear_shift_day(text, date, boolean)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행 불가) '; end if;
  end loop;
  if has_function_privilege('anon', 'public.copy_past_segment(text, date)', 'execute')
     or has_function_privilege('authenticated', 'public.copy_past_segment(text, date)', 'execute') then
    v_bad := v_bad || 'copy_past_segment(내부 전용인데 열려 있음) ';
  end if;
  -- RLS 정책에서 부르는 함수는 authenticated 가 실행할 수 있어야 한다(막히면 표 읽기가 전부 깨진다).
  foreach fn in array array['public.auth_unit_id()', 'public.auth_can_manage()'] loop
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(RLS 에서 쓰는데 authenticated 실행 불가) ';
    end if;
  end loop;
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('mark_shift_day', 'clear_shift_day', 'copy_past_segment', 'owner_labor_inputs_v2', 'my_cross_summary_v2')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;

  if v_bad <> '' then raise exception '0245 자가점검 실패: %', v_bad; end if;
end $$;
