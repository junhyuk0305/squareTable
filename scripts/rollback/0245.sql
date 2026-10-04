-- rollback/0245.sql — 0245 를 되돌린다(copy_past_segment 0243 본문 · _v2 둘 0242 본문 재적용 · 결근 표시 표·RPC 삭제). 원장(migration list)은 건드리지 않는다.
--
-- ★순서: copy_past_segment 를 먼저 0243 본문으로 되돌린 뒤 표를 지운다. 거꾸로 하면 옛 앱 사장의 반복 근무 수정·삭제가
--   없는 표를 건드려 전부 실패한다.
-- ⚠️ 표를 지우면 결근 표시가 모두 사라진다(그 날짜는 다시 근무표대로 지급된다). 적용 전에 `select * from shift_day_marks` 를 떠 둔다.
-- ⚠️ 0246 이 이미 들어갔으면 이 표에 archived_tenure_id 가 달려 있다. 0246 을 먼저 되돌린다.
-- ⚠️ 앱 C(빌드 C)가 이미 나갔으면 그 앱의 결근 처리 버튼이 함수 없음 오류를 낸다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0245.sql --linked

-- ① copy_past_segment — 0243 본문
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
  update public.shift_exceptions set template_id = v_copy where template_id = p_id and date < p_cut;
  update public.swap_requests set template_id = v_copy where template_id = p_id and date < v_cut;
  update public.swap_requests set target_template_id = v_copy
   where target_template_id = p_id and target_date is not null and target_date < v_cut;
  update public.shift_change_requests set template_id = v_copy where template_id = p_id and date < p_cut;
  return v_copy;
end $$;
revoke all on function public.copy_past_segment(text, date) from public, anon, authenticated;

-- ② _v2 둘 — 0242 본문(marks · wage_rates 열 없음). 표를 지우기 전에 되돌린다(남겨 두면 없는 표를 읽어 허브·직원 합계가 실패한다).
drop function if exists public.my_cross_summary_v2();
create function public.my_cross_summary_v2()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions    jsonb,
  month_minutes bigint,
  hourly_wage   int
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
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0)
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
  payroll_settings jsonb
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
    u.payroll_settings
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs_v2() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs_v2() to authenticated;

-- ③ RPC · 표(publication 멤버십은 표와 함께 사라진다)
drop function if exists public.mark_shift_day(text, date, text, boolean);
drop function if exists public.clear_shift_day(text, date, boolean);
drop table if exists public.shift_day_marks;
