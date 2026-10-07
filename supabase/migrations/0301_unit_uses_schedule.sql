-- 0301_unit_uses_schedule.sql — '근무표를 쓰는 매장' 판정을 함수 하나로 (라이브 QA 10-06 결함 5 · 17)
--
-- 문제: 같은 판정이 세 곳에 따로 적혀 있었다.
--   due_task_reminders(0287) · due_quiz_sends(0248) · quiz_send_status(0274)
--   · 하루짜리 근무(shift_date)는 날짜와 상관없이 셌다 → 대타 한 번만 있던 매장이 근무표를 그만 써도 영원히
--     "근무표 쓰는 매장"이 되어, 담당 없는 할일 알림과 퀴즈 발송이 조용히 0건이 됐다.
--   · 퀴즈 두 곳은 재입사 전 옛 근무(archived_tenure_id)까지 셌다. 할일 알림은 뺐다 → 같은 매장이 두 판정으로 갈렸다.
-- 결정 D7: 근무표를 쓰는 매장 = 근무표에 한 사람이라도 등록돼 있는 매장. 여기서 "등록"은 그날 이후에 효력이 있는 근무다.
--   · 하루 근무: shift_date >= 그날(KST)   · 반복 근무: 끝나지 않았거나(valid_to null) 그날 이후에 끝남(0242)
--   · 옛 재직분(archived_tenure_id) 은 뺀다(0246).
-- 방법(⑧): 세 함수 베이스 = 로컬 DB 현재 본문(pg_get_functiondef · 라이브와 같음). 판정 덩어리만 함수 호출로 바꾼다.
--   반환형·권한 불변. 함수 안의 ★주석은 원래 파일(0242·0248·0274·0287)의 설계 근거 그대로다.
-- 옛 앱 호환: 안전 | due_task_reminders·due_quiz_sends 는 크론 전용(클라 호출 0). quiz_send_status 는 새 앱만 부른다.
--   unit_uses_schedule 은 새 내부 함수라 클라에 열지 않는다(다른 매장 근무표 유무를 묻는 길이 되면 안 된다).

create or replace function public.unit_uses_schedule(p_unit text, p_day date)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.shift_templates st
     where st.unit_id = p_unit
       and st.archived_tenure_id is null
       and ((st.shift_date is not null and st.shift_date >= p_day)
            or (st.shift_date is null and (st.valid_to is null or st.valid_to >= p_day))));
$$;
revoke all on function public.unit_uses_schedule(text, date) from public, anon, authenticated;

-- ── due_task_reminders (0287 본문) ──
create or replace function public.due_task_reminders()
returns table(out_template_id text, out_unit_id text, out_text text, out_date text, out_recipients text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamp := (now() at time zone 'Asia/Seoul');
  v_day   text := to_char(v_now, 'YYYY-MM-DD');
  v_time  text := to_char(v_now, 'HH24:MI');
  -- 크론이 멈췄다 복구했을 때 옛 알림이 한꺼번에 터지지 않게 "지난 1시간 내 도달분"만(0118).
  -- ★자정 직후엔 하한이 '23:xx' 가 되어 뒤집히므로 그때는 하한을 적용하지 않는다 —
  --   아래 `(v_floor >= v_time or ...)` 의 앞항이 그 예외다. 이유를 모르고 지우면 자정 알림이 전멸한다.
  v_floor text := to_char(v_now - interval '60 minutes', 'HH24:MI');
  -- ★D6: 어제 날짜. 자정 직후 틱에서 어제 23:56~23:59 할일을 어제 날짜로 보낸다.
  v_prev  text := to_char(v_now - interval '1 day', 'YYYY-MM-DD');
  t record;
  v_rec text[];
begin
  for t in
    select w.id, w.unit_id, w.text, w.remind_at, w.owner_ids, w.scope, c.d as cand_day from public.work_templates w
    cross join lateral (
      -- 오늘 도달분
      select v_day as d where w.remind_at <= v_time and (v_floor >= v_time or w.remind_at > v_floor)
      union all
      -- ★D6: 자정 직후 틱(하한이 뒤집힌 00:00~00:59)에는 어제 하한 뒤 미발송분도 어제 날짜로.
      --   크론이 5분 간격이라 23:56~23:59 는 23:55 틱에선 아직이고 00:00 틱에선 날짜가 바뀌어 영영 빠졌다.
      --   원장(task_reminder_sent)이 (할일, 날짜) 하나라 어제 이미 보낸 것은 다시 안 나간다.
      select v_prev where v_floor >= v_time and w.remind_at > v_floor
    ) c
    where w.remind_at is not null and not public.unit_access_locked(w.unit_id)
      and public.task_occurs_on(w.recurrence, w.date, w.due_date, w.hidden, c.d)
      and not exists (
        select 1 from public.task_reminder_sent s
        where s.template_id = w.id and s.remind_date = c.d
      )
      and not exists (
        select 1 from public.work_done d
        where d.unit_id = w.unit_id and d.work_date = c.d and d.template_id = w.id
      )
    union all
    -- ★D1: 루틴 업무(schedule_config.dayparts 의 routines[].remindAt). 매일 반복 · 매장 전체 할일 · assigneeId = 담당자.
    --   id 규칙은 앱(daypartLabels.ts normalizeRoutines · useWorkStore daypartRoutineTemplates)과 같다.
    select 'dpr_' || r.rid, r.unit_id, r.text, r.remind_at,
           case when r.assignee ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then array[r.assignee::uuid] else '{}'::uuid[] end,
           'shared'::text, c.d
      from (
        select sc.unit_id,
               coalesce(nullif(rt.value->>'id', ''),
                        coalesce(nullif(dp.value->>'id', ''), 'dp_' || (dp.ord - 1)) || '_rt_' || (rt.ord - 1)) as rid,
               coalesce(rt.value->>'text', '') as text,
               btrim(rt.value->>'remindAt') as remind_at,
               nullif(rt.value->>'assigneeId', '') as assignee
          from public.schedule_config sc
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(sc.dayparts) = 'array' then sc.dayparts else '[]'::jsonb end) with ordinality dp(value, ord)
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(dp.value -> 'routines') = 'array' then dp.value -> 'routines' else '[]'::jsonb end) with ordinality rt(value, ord)
         where jsonb_typeof(rt.value) = 'object'
           and btrim(coalesce(rt.value->>'remindAt', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ) r
    cross join lateral (
      select v_day as d where r.remind_at <= v_time and (v_floor >= v_time or r.remind_at > v_floor)
      union all
      select v_prev where v_floor >= v_time and r.remind_at > v_floor
    ) c
    where not public.unit_access_locked(r.unit_id)
      -- 그날 '오늘 하루만 수정' 대체본(0146)이 있으면 원본 루틴은 그날 뜨지 않는다(앱 skipDates 와 같다).
      and not exists (
        select 1 from public.work_templates x
        where x.unit_id = r.unit_id and x.replaces_routine_id = r.rid and coalesce(x.date, x.due_date) = c.d
      )
      and not exists (
        select 1 from public.task_reminder_sent s
        where s.template_id = 'dpr_' || r.rid and s.remind_date = c.d
      )
      and not exists (
        select 1 from public.work_done d
        where d.unit_id = r.unit_id and d.work_date = c.d and d.template_id = 'dpr_' || r.rid
      )
  loop
    v_rec := '{}'::text[];
    -- 담당자가 있으면 private·shared 모두 담당자 전원(근무 여부 무관 · 0254).
    if cardinality(t.owner_ids) > 0 then
      v_rec := t.owner_ids::text[];
      -- ★D3: 지금 매장 멤버인 담당자만 남긴다.
      select coalesce(array_agg(x), '{}'::text[]) into v_rec
      from unnest(v_rec) x
      where exists (
        select 1 from public.unit_members m
        where m.unit_id = t.unit_id and m.user_id = x::uuid
      );
    end if;

    -- 담당 없는 할일, 또는 담당자가 모두 나간 매장 전체 할일 → 그 시각 근무자.
    if cardinality(t.owner_ids) = 0
       or (coalesce(array_length(v_rec, 1), 0) = 0 and t.scope is distinct from 'private') then
      select coalesce(array_agg(distinct x), '{}'::text[]) into v_rec
      from public.workers_at(t.unit_id, t.cand_day, t.remind_at) x;
      -- 그 시각 근무자가 없을 때:
      --   · 근무표를 안 쓰는 매장 → 매장 전원(fail-open, 0118). 여기서 닫으면 '전체 할일' 알림이 통째로 사라진다.
      --   · ★D7: 근무표를 쓰는 매장(근무표에 한 사람이라도 있다) → 보내지 않는다. 쉬는 사람에게 가지 않게.
      --     "근무표를 쓴다"는 퀴즈 발송(due_quiz_sends · 0248)과 같은 판정이다. 이미 끝난 반복 행은 세지 않는다.
      if coalesce(array_length(v_rec, 1), 0) = 0
         and not public.unit_uses_schedule(t.unit_id, t.cand_day::date) then   -- ★0301: 판정 함수 하나(퀴즈와 같음)
        select coalesce(array_agg(m.user_id::text), '{}'::text[]) into v_rec
        from public.unit_members m where m.unit_id = t.unit_id;
      end if;
    end if;

    -- ★매장 소속 필터(0153). owner_id 에 아무 uuid 나 꽂아 임의 사용자에게 푸시를 보내는
    --   경로(0127 C1)를 여기서 닫는다. 위 갈래 어느 쪽으로 왔든 한 번에 거른다.
    if coalesce(array_length(v_rec, 1), 0) > 0 then
      select coalesce(array_agg(x), '{}'::text[]) into v_rec
      from unnest(v_rec) x
      where exists (
        select 1 from public.unit_members m
        where m.unit_id = t.unit_id and m.user_id = x::uuid
      );
    end if;

    if coalesce(array_length(v_rec, 1), 0) > 0 then
      out_template_id := t.id;
      out_unit_id     := t.unit_id;
      out_text        := t.text;
      out_date        := t.cand_day;
      out_recipients  := v_rec;
      return next;
    end if;
  end loop;
end $$;

-- ── due_quiz_sends (0248 본문 · 0270 workers_at 반영) ──
create or replace function public.due_quiz_sends()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamp := (now() at time zone 'Asia/Seoul');
  v_date   date := v_now::date;
  v_day    text := to_char(v_now, 'YYYY-MM-DD');
  v_time   text := to_char(v_now, 'HH24:MI');
  a        record;
  h        record;
  v_streak int;
  -- 이번 스윕에서 이미 뽑은 (매장,사람). 아직 sent_at 이 안 찍혔으므로 원장 조회만으로는
  -- 같은 사람이 한 스윕에 2건 뽑히는 것을 못 막는다(하루 1회가 조용히 깨지는 경로다).
  v_taken  text[] := '{}';
  v_key    text;
begin
  -- ── §0 (0169) 변경 트리거: 후보를 고르기 **전에** 큐를 채운다 ──────────────
  --    이 순서라야 방금 검수가 끝난 재확인이 같은 스윕에서 바로 후보가 된다(5분 더 안 기다린다).
  begin
    perform public.enqueue_knowhow_rechecks();
  exception when others then
    raise warning 'knowhow recheck enqueue skipped: %', sqlerrm;
  end;

  for a in
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       and c.active
       -- ★0248: 담긴 노하우가 전부 보관된 퀴즈는 닫는다(되살리면 다시 열린다). 담긴 노하우가 없는 코스는 예전 그대로다.
       and not (exists (select 1 from public.course_entries ce where ce.course_id = c.id)
                and not exists (select 1 from public.course_entries ce
                                  join public.playbook_entries pe on pe.id = ce.entry_id
                                 where ce.course_id = c.id and pe.archived_at is null))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
     order by qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    --    ★0242: 이미 끝난 반복 행(valid_to < 오늘 · 지난 구간 복사본)은 "근무표를 쓴다"로 세지 않는다.
    --           안 빼면 근무표를 그만 쓴 매장은 퀴즈가 영원히 0건이 된다.
    --    ★0301: 판정은 unit_uses_schedule 하나(할일 알림과 같음). 지난 하루 근무·옛 재직분 근무는 세지 않는다.
    if public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창).
    if (
      select count(*) from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'
    ) >= 2 then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then continue; end if;

    v_taken := v_taken || v_key;
    out_assignment_id := a.id;
    out_unit_id       := a.unit_id;
    out_user_id       := a.user_id::text;
    out_course_name   := a.course_name;
    return next;
  end loop;
end $$;

-- ── quiz_send_status (0274 본문) ──
create or replace function public.quiz_send_status(p_course_id text)
returns table(user_id uuid, reason text)
language plpgsql
stable security definer
set search_path = public
as $$
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
    if public.unit_uses_schedule(v_unit, v_date)   -- ★0301: due_quiz_sends 와 같은 판정 함수
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

-- ── 권한(재정의 전과 같게) ──
revoke all on function public.due_task_reminders() from public, anon, authenticated;
grant execute on function public.due_task_reminders() to service_role;
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant execute on function public.due_quiz_sends() to service_role;
revoke all on function public.quiz_send_status(text) from public, anon, authenticated;
grant  execute on function public.quiz_send_status(text) to authenticated;

-- ── 자가점검 ──
do $$
begin
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('anon', 'public.due_quiz_sends()', 'execute')
     or has_function_privilege('authenticated', 'public.due_quiz_sends()', 'execute')
     or has_function_privilege('anon', 'public.quiz_send_status(text)', 'execute')
     or has_function_privilege('authenticated', 'public.unit_uses_schedule(text, date)', 'execute') then
    raise exception '0301 자가점검 실패 — 크론·내부 함수가 클라에 열려 있다';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('due_task_reminders', 'due_quiz_sends', 'quiz_send_status')
       and p.prosrc like '%unit_uses_schedule(%') <> 3 then
    raise exception '0301 자가점검 실패 — 판정 함수를 안 쓰는 곳이 있다';
  end if;
end $$;
