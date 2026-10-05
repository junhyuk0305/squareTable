-- 0271_task_reminder_before_midnight.sql — 23:56~23:59 로 정한 할일 알림도 나간다 (2026-10-06 · 논리 점검 D6)
--
-- 크론은 5분마다 돈다(0118 '*/5 * * * *'). 할일 시간을 23:57 로 두면
--   · 23:55 틱: '23:57' <= '23:55' 가 아니라 아직
--   · 00:00 틱: 날짜가 다음 날로 바뀌어 '23:57' <= '00:00' 이 아니라 제외
-- 그래서 알림이 한 번도 안 갔다. 5분 배수가 아닌 23:5x 도 같았다.
--
-- 자정 직후 틱(하한이 뒤집힌 00:00~00:59)에는 어제 날짜의 하한 뒤 미발송분도 후보로 넣는다.
-- 그 행은 발생일·완료·발송 원장·근무자·out_date 모두 어제 날짜로 본다(엣지는 out_date 로 원장을 쓴다).
--
-- ★본문 = 0269 due_task_reminders(0153 + 0254 담당자 + 0265 잠긴 매장 제외 + 0269 나간 담당자) + 위 후보.
--   grant 는 그대로(service_role 전용).

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
    select w.*, c.d as cand_day from public.work_templates w
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
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%t.scope is distinct from ''private''%' then
    raise exception '0271 자가점검 실패 — 0254·0265·0269 변경이 사라졌다';
  end if;
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.due_task_reminders()', 'execute') then
    raise exception '0271 자가점검 실패 — due_task_reminders 가 클라에 열렸다';
  end if;
  raise notice '0271 자가점검 통과';
end $$;
