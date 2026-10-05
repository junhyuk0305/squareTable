-- 0245 — 시급 이력을 _v2 판정 함수로 내려 준다 (J1-b 후속 · 2026-10-05 정정)
--
-- ★2026-10-05 사용자 결정: 결근 표시 기능은 필요 없다. 이 파일은 원래 결근 표시 shift_day_marks(J1-c)를 만들었지만
--   라이브에 나가기 전에 그 부분을 걷어 냈다. 표 · mark_shift_day · clear_shift_day · copy_past_segment 의 표시 옮기기 ·
--   _v2 의 marks 열이 없다. 그래서 copy_past_segment 는 0243 정의가 최신이다.
--   0246(archived_tenure_id) · 0247(보관 기간 정리)도 같은 날 이 표를 빼도록 고쳤다.
--
-- 남는 것: owner_labor_inputs_v2 · my_cross_summary_v2(0242 본문 승계 + wage_rates 열).
--   wage_rates_read(0244)는 활성 매장 행만 보인다. 허브와 다매장 직원은 이 두 정의자 함수로만 다른 매장 시급 이력을 받는다.
--   RLS 는 넓히지 않는다. 방어선은 0242 그대로(사장 = u.owner_id = auth.uid() · 직원 = 본인 멤버십 · 본인 이력만).
-- 함수 담당표: owner_labor_inputs_v2 · my_cross_summary_v2 = 0242 → 0245 → 0246.
-- 되돌리기: scripts/rollback/0245.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① owner_labor_inputs_v2 · my_cross_summary_v2 (0242 본문 승계 + wage_rates 열)
-- ════════════════════════════════════════════════════════════════════════════
-- 반환 열이 늘어 create or replace 로는 못 바꾼다 → drop 뒤 다시 만든다.
-- 옛 앱용 v1(owner_labor_inputs · my_cross_summary)은 그대로다.
drop function if exists public.my_cross_summary_v2();
create function public.my_cross_summary_v2()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions    jsonb,
  month_minutes bigint,
  hourly_wage   int,
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
-- ② 자가점검 — 본문 · 권한
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  r     record;
begin
  v_def := pg_get_functiondef('public.owner_labor_inputs_v2()'::regprocedure);
  if position('wage_rates' in v_def) = 0 or position('owner_id = auth.uid()' in v_def) = 0 or position('valid_to' in v_def) = 0 then
    v_bad := v_bad || 'owner_labor_inputs_v2(시급 이력·소유 매장 방어선·기간 중 빠짐) ';
  end if;
  v_def := pg_get_functiondef('public.my_cross_summary_v2()'::regprocedure);
  if position('wage_rates' in v_def) = 0 or position('m.user_id = auth.uid()' in v_def) = 0
     or position('wr.staff_id = auth.uid()' in v_def) = 0 then
    v_bad := v_bad || 'my_cross_summary_v2(시급 이력·본인 멤버십·본인 이력만 중 빠짐) ';
  end if;
  foreach fn in array array['public.owner_labor_inputs_v2()', 'public.my_cross_summary_v2()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행 불가) '; end if;
  end loop;
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('owner_labor_inputs_v2', 'my_cross_summary_v2')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;
  if v_bad <> '' then raise exception '0245 자가점검 실패: %', v_bad; end if;
end $$;
