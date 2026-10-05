-- 0257 · 허브 인건비·예상 급여를 직원 관리·출퇴근 화면과 같은 공식으로(QA 논리 점검 2026-10-05 A7)
--
-- ① owner_labor_inputs_v2 + departed: 사장 홈 '이번달 인건비'가 이번 달 퇴사자 몫을 빼고 셌다.
--    close_member_tenure 가 profiles.unit_id 를 옮겨 staff_ids 에서 빠지기 때문이다. 직원 관리 히어로는 퇴사자 줄을 더한다.
--    이번 달(KST)에 닫힌 기간 중 지금 멤버가 아닌 사람을 준다. 금액은 클라가 직원 관리와 같은 departedPayRows 로 낸다.
-- ② my_cross_summary_v2 + payroll_settings: 직원 허브 '예상 급여'가 출퇴근 분 × 시급이었다.
--    출퇴근 화면은 근무표 기준 computePay(휴게·야간·연장·주휴)다. 같은 계산을 하려면 매장 급여 설정이 필요하다.
--
-- 본문은 0246 정의를 그대로 옮기고 열 하나씩만 더했다. 반환형이 바뀌어 drop 후 다시 만든다(권한도 그대로 다시 준다).
-- 옛 앱은 늘어난 열을 무시한다.

-- ════════════════════════════════════════════════════════════════════════════
-- ① owner_labor_inputs_v2 (0246 본문 + departed)
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.owner_labor_inputs_v2();
create function public.owner_labor_inputs_v2()
returns table(
  unit_id          text,
  staff_ids        jsonb,
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end, valid_from, valid_to}]
  exceptions       jsonb,
  wages            jsonb,
  payroll_settings jsonb,
  wage_rates       jsonb,  -- ★0245: [{staff_id, effective_from, hourly_wage}] 그 매장 시급 이력 전부
  departed         jsonb   -- ★0257: [{id, user_id, joined_at, left_at, name_snapshot, final_hourly_wage}] 이번 달 퇴사자 기간
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
        and st.archived_tenure_id is null      -- ★0246
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
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.staff_id, wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id
        and wr.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'user_id', t.user_id, 'joined_at', t.joined_at, 'left_at', t.left_at,
               'name_snapshot', t.name_snapshot, 'final_hourly_wage', t.final_hourly_wage)
             order by t.left_at)
      from public.member_tenures t
      where t.unit_id = u.id
        and t.left_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
        and not exists (select 1 from public.unit_members m where m.unit_id = u.id and m.user_id = t.user_id)
    ), '[]'::jsonb)
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs_v2() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs_v2() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② my_cross_summary_v2 (0246 본문 + payroll_settings)
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.my_cross_summary_v2();
create function public.my_cross_summary_v2()
returns table(
  unit_id          text,
  store_name       text,
  shifts           jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions       jsonb,
  month_minutes    bigint,
  hourly_wage      int,
  wage_rates       jsonb,   -- ★0245: [{staff_id, effective_from, hourly_wage}] 본인 시급 이력
  payroll_settings jsonb    -- ★0257: units.payroll_settings 그대로. null = 기본 규칙
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
        and st.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
        and st2.archived_tenure_id is null     -- ★0246
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and a.staff_id = auth.uid()::text
        and a.archived_tenure_id is null       -- ★0246
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id and wr.staff_id = auth.uid()::text
        and wr.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    u.payroll_settings
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
revoke all on function public.my_cross_summary_v2() from public, anon, authenticated;
grant execute on function public.my_cross_summary_v2() to authenticated;
