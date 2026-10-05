-- 0269_task_departed_assignee.sql — 담당자가 모두 나간 "매장 전체" 할일도 알림이 간다 (2026-10-06 · 논리 점검 D3)
--
-- 0254 부터 담당자가 있으면 매장 전체 할일도 담당자에게만 보낸다. 그런데 담당자가 매장을 나가면
-- owner_ids 에 그 사람이 그대로 남는다. 매장 소속 필터(0153)가 그를 빼면 수신자가 0명이 되고,
-- 근무자 → 매장 전원 갈래는 이미 지나간 뒤라 알림이 아무에게도 안 갔다. 수정 화면에는 '직원'이라는
-- 알 수 없는 담당 꼬리표가 남고 저장할 때마다 다시 저장됐다.
--
-- ① due_task_reminders: 담당자를 먼저 매장 멤버로 거른다. 남은 사람이 0명이면 매장 전체 할일은
--    담당 없는 할일과 같은 갈래(그 시각 근무자 → 없으면 매장 전원)로 내려간다.
--    개인 할일(private)은 내려가지 않는다. 남의 개인 할일 내용이 근무자에게 가면 안 된다.
-- ② 매장을 나가면(unit_members 행 삭제 · 어떤 경로든) 그 매장 "매장 전체" 할일 담당자에서 뺀다.
--    wt_sync_owner_ids(0254) 트리거가 owner_id 도 맞춘다. 개인 할일은 건드리지 않는다.
-- ③ 이미 나간 사람이 담당자로 남은 매장 전체 할일을 한 번 정리한다.
--
-- ★due_task_reminders 본문 = 0153 본문 + 0254 담당자 치환 + 0265 잠긴 매장 제외. 세 변경을 모두 싣는다.
--   grant 는 0153 그대로(service_role 전용).

-- ── ① 알림 후보 ───────────────────────────────────────────────────────────
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
  t record;
  v_rec text[];
begin
  for t in
    select w.* from public.work_templates w
    where w.remind_at is not null and not public.unit_access_locked(w.unit_id)
      and w.remind_at <= v_time
      and (v_floor >= v_time or w.remind_at > v_floor)
      and public.task_occurs_on(w.recurrence, w.date, w.due_date, w.hidden, v_day)
      and not exists (
        select 1 from public.task_reminder_sent s
        where s.template_id = w.id and s.remind_date = v_day
      )
      and not exists (
        select 1 from public.work_done d
        where d.unit_id = w.unit_id and d.work_date = v_day and d.template_id = w.id
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
      from public.workers_at(t.unit_id, v_day, t.remind_at) x;
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
      out_date        := v_day;
      out_recipients  := v_rec;
      return next;
    end if;
  end loop;
end $$;

revoke execute on function public.due_task_reminders() from public, anon, authenticated;
grant  execute on function public.due_task_reminders() to service_role;

-- ── ② 매장을 나가면 매장 전체 할일 담당자에서 뺀다 ───────────────────────
create or replace function public.wt_drop_departed_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.work_templates
     set owner_ids = array_remove(owner_ids, old.user_id)
   where unit_id = old.unit_id
     and coalesce(scope, 'shared') = 'shared'
     and old.user_id = any(owner_ids);
  return old;
end $$;
revoke all on function public.wt_drop_departed_assignee() from public, anon, authenticated;

drop trigger if exists wt_drop_departed_assignee on public.unit_members;
create trigger wt_drop_departed_assignee
  after delete on public.unit_members
  for each row execute function public.wt_drop_departed_assignee();

-- ── ③ 이미 나간 사람이 담당자로 남은 매장 전체 할일 정리 ──────────────────
update public.work_templates w
   set owner_ids = coalesce(array(
         select x from unnest(w.owner_ids) x
          where exists (select 1 from public.unit_members m where m.unit_id = w.unit_id and m.user_id = x)
       ), '{}'::uuid[])
 where coalesce(w.scope, 'shared') = 'shared'
   and exists (
     select 1 from unnest(w.owner_ids) x
      where not exists (select 1 from public.unit_members m where m.unit_id = w.unit_id and m.user_id = x)
   );

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare v_bad int;
begin
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%and not public.unit_access_locked(w.unit_id)%'
     or pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%if cardinality(t.owner_ids) > 0 then%' then
    raise exception '0269 자가점검 실패 — 0254 담당자 판정이나 0265 잠긴 매장 제외가 사라졌다';
  end if;
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.due_task_reminders()', 'execute') then
    raise exception '0269 자가점검 실패 — due_task_reminders 가 클라에 열렸다';
  end if;
  select count(*) into v_bad from public.work_templates w
   where coalesce(w.scope, 'shared') = 'shared'
     and exists (select 1 from unnest(w.owner_ids) x
                  where not exists (select 1 from public.unit_members m where m.unit_id = w.unit_id and m.user_id = x));
  if v_bad > 0 then
    raise exception '0269 자가점검 실패 — 나간 담당자가 남은 매장 전체 할일 %개', v_bad;
  end if;
  raise notice '0269 자가점검 통과';
end $$;
