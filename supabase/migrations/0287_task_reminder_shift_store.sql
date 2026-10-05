-- 0287_task_reminder_shift_store.sql — 근무표를 쓰는 매장은 할일 알림을 그 시각 근무자에게만 보낸다 (2026-10-06 · 논리 점검 D7)
--
-- 사장님 결정: 근무표를 쓰는 매장 = 근무표(반복 근무 · 날짜 근무)에 한 사람이라도 등록돼 있는 매장.
--   그 매장은 그 시각 근무자에게만 보내고, 근무자가 없으면 보내지 않는다. 근무표를 안 쓰는 매장은 지금처럼 보낸다.
--   담당자가 정해진 할일은 담당자에게(지금 규칙 그대로).
--
-- 예전: 담당 없는 매장 전체 할일은 그 시각 근무자가 없으면 매장 전원에게 갔다(0118 fail-open).
--   첫 근무 09:00 매장의 08:30 '오픈 준비'나 정기휴무 요일의 매일 할일이 쉬는 직원 폰까지 울렸다.
--   같은 상황의 퀴즈 발송(due_quiz_sends)은 근무표를 쓰는 매장이면 보내지 않는다. 그 판정에 맞춘다.
--   "등록돼 있다"에서 재입사 전 옛 근무(archived_tenure_id)와 이미 끝난 반복 행(valid_to 가 그날 전)은 뺀다.
--
-- ★본문 = 0286 due_task_reminders 그대로 + 위 fail-open 조건 하나. grant 는 그대로(service_role 전용).

create or replace function public.due_task_reminders()
returns table (
  out_template_id text,
  out_unit_id     text,
  out_text        text,
  out_date        text,
  out_recipients  text[]
) language plpgsql security definer set search_path = public as $$
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
         and not exists (
           select 1 from public.shift_templates st
            where st.unit_id = t.unit_id
              and st.archived_tenure_id is null
              and (st.shift_date is not null or st.valid_to is null or st.valid_to >= t.cand_day::date)
         ) then
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

revoke execute on function public.due_task_reminders() from public, anon, authenticated;
grant  execute on function public.due_task_reminders() to service_role;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%and not public.unit_access_locked(w.unit_id)%'
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%if cardinality(t.owner_ids) > 0 then%'
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%t.scope is distinct from ''private''%'
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%select v_prev where%'
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%replaces_routine_id = r.rid%' then
    raise exception '0287 자가점검 실패 — 0254·0265·0269·0271·0286 변경이 사라졌다';
  end if;
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%st.valid_to >= t.cand_day::date%' then
    raise exception '0287 자가점검 실패 — 근무표 매장 조건이 없다';
  end if;
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.due_task_reminders()', 'execute') then
    raise exception '0287 자가점검 실패 — due_task_reminders 가 클라에 열렸다';
  end if;
  raise notice '0287 자가점검 통과';
end $$;
