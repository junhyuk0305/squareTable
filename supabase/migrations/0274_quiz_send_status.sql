-- 0274_quiz_send_status.sql — 퀴즈가 아직 안 나간 이유를 사장 화면에 준다 (2026-10-06 · 논리 점검 E3)
--
-- due_quiz_sends(0248)는 두 경우에 조용히 건너뛴다. 원장 행은 sent_at=null 로 남고 사장 화면은 '발송 중'만 보였다.
--   ① 근무표를 쓰는 매장인데 그 사람이 근무표에 없다 → 근무하는 시각이 영영 오지 않는다.
--   ② 연속 2회 안 열었다(자동 정지) → 그 사람이 지난 퀴즈를 열 때까지 안 나간다.
-- 이 함수는 한 퀴즈의 아직 안 나간 사람마다 이유 하나를 돌려준다. 이유가 없으면 행이 없다(곧 나간다).
--   'not_scheduled' = ① · 오늘 이후 근무가 하나도 없다(오늘 근무가 끝났을 뿐이면 내일 나가므로 세지 않는다).
--   'auto_stopped'  = ② · 셈은 due_quiz_sends ④ 와 같다(24시간 안 된 발송은 아직 무시가 아니다).
-- 판정은 0248 due_quiz_sends · 0242 '근무표를 쓴다' 조건을 그대로 옮겼다. 바꿀 때 같이 고친다.
-- 읽기 전용이다. 관리 권한(owner·manager)이 활성 매장의 퀴즈만 본다.

create or replace function public.quiz_send_status(p_course_id text)
returns table (user_id uuid, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_date   date := (now() at time zone 'Asia/Seoul')::date;
  v_unit   text;
  a        record;
  h        record;
  v_streak int;
begin
  if not public.auth_can_manage() then return; end if;
  select c.unit_id into v_unit
    from public.training_courses c
   where c.id = p_course_id and c.unit_id = public.auth_unit_id();
  if v_unit is null then return; end if;

  for a in
    select distinct qa.user_id
      from public.quiz_assignments qa
     where qa.course_id = p_course_id
       and qa.sent_at is null
       and qa.scheduled_on <= v_date
       and exists (select 1 from public.unit_members m where m.unit_id = qa.unit_id and m.user_id = qa.user_id)
  loop
    -- ① 근무표를 쓰는 매장(0242 조건)인데 이 사람의 오늘 이후 근무가 없다.
    if exists (select 1 from public.shift_templates st
                where st.unit_id = v_unit
                  and (st.shift_date is not null or st.valid_to is null or st.valid_to >= v_date))
       and not exists (select 1 from public.shift_templates st
                        where st.unit_id = v_unit
                          and st.staff_id = a.user_id::text
                          and st.archived_tenure_id is null
                          and (st.shift_date >= v_date
                               or (st.shift_date is null and (st.valid_to is null or st.valid_to >= v_date)))) then
      user_id := a.user_id; reason := 'not_scheduled';
      return next;
      continue;
    end if;

    -- ② 연속 2회 무시(due_quiz_sends ④ 와 같은 셈).
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = v_unit and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then
      user_id := a.user_id; reason := 'auto_stopped';
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.quiz_send_status(text) from public, anon, authenticated;
grant  execute on function public.quiz_send_status(text) to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.quiz_send_status(text)', 'execute') then
    raise exception '0274 자가점검 실패 — quiz_send_status 가 anon 에 열렸다';
  end if;
  raise notice '0274 자가점검 통과';
end $$;
