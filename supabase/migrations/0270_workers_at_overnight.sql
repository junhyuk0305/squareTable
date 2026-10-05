-- 0270_workers_at_overnight.sql — 자정을 넘는 근무의 "지금 근무자"를 전날 시작한 근무로 판정한다 (2026-10-06 · 논리 점검 D5)
--
-- 예전 workers_at 은 p_day 요일 행 하나만 봤다. 심야 행(22:00~02:00)은 같은 행에서
-- "시작 이후 OR 끝 이전"으로 맞췄다. 그래서 화요일 01:00 에는
--   · 월요일 밤 22:00 에 출근해 지금 일하는 A 는 빠지고
--   · 화요일 밤 22:00 에 출근할 B 가 잡혔다.
-- 할일 알림(due_task_reminders)과 퀴즈 발송(due_quiz_sends)이 이 함수를 쓴다.
--
-- 이제 두 갈래로 나눈다.
--   ① 오늘 시작한 근무: 낮 근무는 [시작, 끝), 심야 근무는 시작 이후만.
--   ② 어제 시작한 심야 근무: 끝 시각 전까지. 적용 기간·그날 예외·옛 재직 표시는 어제 날짜로 본다.
--
-- ★본문 = 0246 workers_at(0242 적용 기간 + 0178 예외 + 0246 표시 조건) 그대로 + 위 두 갈래.
--   grant 는 0246 그대로(service_role 전용).
create or replace function public.workers_at(p_unit text, p_day text, p_time text)
returns setof text language sql stable set search_path = public as $$
  -- ① 오늘 시작한 근무
  select st.staff_id
    from public.shift_templates st
   where st.unit_id = p_unit
     and st.archived_tenure_id is null      -- ★0246: 재입사 전 옛 근무는 없는 것으로 친다
     and (case when st.shift_date is null then st.weekday = extract(dow from p_day::date)::int
               else st.shift_date = p_day::date end)
     -- ★0242: 반복 근무는 적용 기간 안의 날에만(지난 구간 복사본과 원래 행이 같은 날 두 번 잡히지 않는다).
     and (st.shift_date is not null
          or (st.valid_from <= p_day::date and (st.valid_to is null or st.valid_to >= p_day::date)))
     -- ★그날 예외로 떼어낸 반복은 없는 것으로 친다(0178). 빠뜨리면 근무가 두 벌로 잡힌다.
     and (st.shift_date is not null or not exists (
            select 1 from public.shift_exceptions e
             where e.template_id = st.id and e.date = p_day::date))
     and case when st.start_time <= st.end_time
              then (p_time >= st.start_time and p_time < st.end_time)
              else p_time >= st.start_time    -- 심야(22:00~02:00): 오늘 밤 시작 이후만
         end
  union
  -- ② ★D5: 어제 시작해 자정을 넘긴 근무의 꼬리(어제 22:00~오늘 02:00 의 00:00~02:00)
  select st.staff_id
    from public.shift_templates st
   where st.unit_id = p_unit
     and st.archived_tenure_id is null
     and (case when st.shift_date is null then st.weekday = extract(dow from (p_day::date - 1))::int
               else st.shift_date = p_day::date - 1 end)
     and (st.shift_date is not null
          or (st.valid_from <= p_day::date - 1 and (st.valid_to is null or st.valid_to >= p_day::date - 1)))
     and (st.shift_date is not null or not exists (
            select 1 from public.shift_exceptions e
             where e.template_id = st.id and e.date = p_day::date - 1))
     and st.start_time > st.end_time
     and p_time < st.end_time
$$;
revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;
grant  execute on function public.workers_at(text, text, text) to service_role;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.workers_at(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.workers_at(text, text, text)', 'execute') then
    raise exception '0270 자가점검 실패 — workers_at 이 클라에 열렸다';
  end if;
  raise notice '0270 자가점검 통과';
end $$;
