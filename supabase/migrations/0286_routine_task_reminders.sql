-- 0286_routine_task_reminders.sql — 루틴 업무의 업무 시간에도 알림을 보낸다 (2026-10-06 · 논리 점검 D1 · 사장님 결정 ①)
--
-- 루틴 업무는 work_templates 행이 아니다. 매장 설정 schedule_config.dayparts 의 routines[] 에만 있고,
-- 앱이 매일 'dpr_' + 루틴 id 로 할일을 만들어 보여 준다(useWorkStore daypartRoutineTemplates).
-- 업무 시간(remindAt)을 넣으면 화면은 "이 시간에 알림이 가요"라고 하는데, 5분 크론의 due_task_reminders 는
-- work_templates 만 훑어서 알림이 한 번도 나가지 않았다.
--
-- 바꾸는 것
--   ① due_task_reminders 에 루틴 갈래를 더한다(근거 문서 D1 A안).
--      · 후보 = dayparts 배열의 routines 중 remindAt 이 HH:MM 인 것. id 는 앱과 같은 규칙(없으면 '<카테고리id>_rt_<순번>').
--      · 할일 id = 'dpr_' + 루틴 id. 완료 판정(work_done.template_id) · 발송 원장 키도 이 값이다.
--      · 그날 대체본(0146 replaces_routine_id = 루틴 id · date 또는 due_date = 그날)이 있으면 원본은 건너뛴다.
--        대체본은 work_templates 행이라 자기 remind_at 으로 따로 나간다.
--      · 수신자 규칙은 일반 할일과 같다. 루틴은 매장 전체(scope shared) 할일이고 assigneeId 가 담당자다
--        (담당자 → 매장 멤버만 · 없거나 다 나갔으면 그 시각 근무자 → 없으면 매장 전원).
--   ② 발송 원장 task_reminder_sent 의 template_id 외래키(work_templates)를 내린다. 'dpr_…' 는 work_templates 에
--      없어서 엣지의 선점 insert 가 실패하고 알림이 영영 안 나간다. 엣지는 바꾸지 않는다(배포 불필요).
--      할일을 지우면 원장도 지우던 동작(on delete cascade)은 트리거로 그대로 둔다. 매장 삭제 cascade(unit_id)는 그대로다.
--
-- ★본문 = 0271 due_task_reminders(0153 + 0254 담당자 + 0265 잠긴 매장 제외 + 0269 나간 담당자 + 0271 자정 직전) +
--   위 루틴 갈래. 반복문 안(수신자 판정)은 한 글자도 바꾸지 않았다. grant 는 그대로(service_role 전용).

-- ── ② 원장 외래키 ───────────────────────────────────────────────────────────
alter table public.task_reminder_sent drop constraint if exists task_reminder_sent_template_id_fkey;

create or replace function public.task_reminder_sent_drop_template()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.task_reminder_sent where template_id = old.id;
  return old;
end $$;
revoke all on function public.task_reminder_sent_drop_template() from public, anon, authenticated;

drop trigger if exists trg_task_reminder_sent_drop on public.work_templates;
create trigger trg_task_reminder_sent_drop
  after delete on public.work_templates
  for each row execute function public.task_reminder_sent_drop_template();

-- ── ① due_task_reminders ────────────────────────────────────────────────────
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
      -- 근무표에 그 시각 근무자가 없으면 매장 전원(fail-open, 0118) — 근무표를 안 쓰는 매장이 다수라
      -- 여기서 닫으면 '전체 할일' 알림이 그 매장에서 통째로 사라진다.
      if coalesce(array_length(v_rec, 1), 0) = 0 then
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
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%select v_prev where%' then
    raise exception '0286 자가점검 실패 — 0254·0265·0269·0271 변경이 사라졌다';
  end if;
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%replaces_routine_id = r.rid%' then
    raise exception '0286 자가점검 실패 — 루틴 갈래가 없다';
  end if;
  if exists (select 1 from pg_constraint where conname = 'task_reminder_sent_template_id_fkey') then
    raise exception '0286 자가점검 실패 — 원장 외래키가 남아 루틴 선점이 실패한다';
  end if;
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.due_task_reminders()', 'execute') then
    raise exception '0286 자가점검 실패 — due_task_reminders 가 클라에 열렸다';
  end if;
  raise notice '0286 자가점검 통과';
end $$;
