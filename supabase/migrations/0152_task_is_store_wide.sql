-- 0152_task_is_store_wide.sql — 할일에는 방 개념이 없다 (방 격리 제거)
--
-- ── 확정된 원칙 ────────────────────────────────────────────────────────────
--   **"어떤 방의 할일"이라는 개념은 없다. 할일은 사람에게 배정된다.**
--   방마다 할일을 나누면 사장 입장에서 복잡해진다. 구조는 `할일 → 사람` 하나뿐이고,
--   방은 그 사람들이 모여 있는 곳일 뿐이다.
--
--   따라서 매장 전체 할일(scope='shared')은 **어느 방에서 만들었든 매장 전원**에게 보인다.
--   개인 할일(scope='private')은 그대로 본인만 본다.
--
-- ── 왜 이걸 안 하면 규칙이 성립하지 않나 ───────────────────────────────────
-- 0015 가 *"전부 방 단위로"* 라며 work_templates·work_done 에도 can_see_room 을 걸어놨다.
--   → 내가 안 들어간 방에서 만든 매장 전체 할일을 **서버가 아예 안 내려준다.**
--   → 화면을 어떻게 짜도 안 보인다. 0147(사장 자동참여 폐지) 때문에 사장에게도 똑같이 발생한다.
--
-- ── 방향이 반대인 변경 ─────────────────────────────────────────────────────
-- 0147~0151 은 전부 **좁히는**(fail-closed) 쪽인데 이것만 **넓힌다.** 그래서 마지막에 둔다.
--   · unit_id 매장 격리는 **그대로 남는다** — 빠지는 것은 방 격리뿐이다.
--   · scope 조건도 그대로 — 개인 할일은 owner_id/created_by 가 지킨다(0017).
--     **방 격리가 개인 할일을 지켜주던 게 아니다.**
--
-- ── ⛔ 건드리지 않는 것 ────────────────────────────────────────────────────
--   · work_feed(메시지·공지·완료알림)의 방 조건 — 대화와 공지는 방의 것이다.
--   · can_see_room() 함수 본문 — work_feed 가 계속 쓴다. 정책 쪽에서 조건을 뺀다.
--   · work_templates.room_id 컬럼 — "어디서 만들어졌나" 흔적으로 남긴다(가시성 판정에서만 뺀다).

do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then

    -- ── 할일 SELECT: 0017 본문 승계 + 방 조건 제거 ────────────────────────
    drop policy if exists wt_select_scope on public.work_templates;
    create policy wt_select_scope on public.work_templates
      for select using (
        unit_id = (select public.auth_unit_id())
        -- ★ and (room_id is null or public.can_see_room(room_id))  ← 0152 에서 제거
        and (
          coalesce(scope, 'shared') = 'shared'
          or owner_id = (select auth.uid())
          or created_by = (select auth.uid())
          -- 레거시 private(작성자 미상): 기존 동작 보존 — 사장은 계속 조회 가능(0017).
          or (created_by is null and (select public.auth_is_owner()))
        )
      );

    -- ── 할일 INSERT: 방 조건 제거 ─────────────────────────────────────────
    drop policy if exists wt_insert on public.work_templates;
    create policy wt_insert on public.work_templates
      for insert with check (unit_id = (select public.auth_unit_id()));

    -- ── 할일 UPDATE·DELETE: 0150 본문 승계 + 방 조건 제거 ─────────────────
    drop policy if exists wt_update on public.work_templates;
    create policy wt_update on public.work_templates
      for update using (
        unit_id = (select public.auth_unit_id())
        and (
          (select public.auth_can_manage())
          or created_by = (select auth.uid())
          or created_by is null                 -- 레거시 grandfather(0150)
        )
      )
      with check (
        unit_id = (select public.auth_unit_id())
        and (
          (select public.auth_can_manage())
          or created_by = (select auth.uid())
          or created_by is null
        )
      );

    drop policy if exists wt_delete on public.work_templates;
    create policy wt_delete on public.work_templates
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (
          (select public.auth_can_manage())
          or created_by = (select auth.uid())
          or created_by is null
        )
      );

    -- ── 완료마크: 방 조건 제거 ────────────────────────────────────────────
    -- 할일이 매장 전체면 그 완료도 매장 전체가 봐야 한다. 안 그러면 "할일은 보이는데
    -- 누가 했는지는 안 보이는" 반쪽 상태가 된다.
    drop policy if exists work_done_rw on public.work_done;
    create policy work_done_rw on public.work_done
      for all
      using      (unit_id = (select public.auth_unit_id()))
      with check (unit_id = (select public.auth_unit_id()));
  end if;
end $$;

-- ── 할일 시간 알림(0118/0126)의 방 필터도 뺀다 ────────────────────────────
-- ★정본 재확정: 0126 본문 전체를 다시 싣는다. 바뀐 곳은 **수신자 방 필터 한 블록 제거**뿐이다.
--   0126 이 그 필터를 넣은 이유는 "비공개 방 업무의 본문이 방 밖 직원의 잠금화면에 떴다"였는데,
--   할일이 매장 전체가 된 지금은 그 전제가 사라졌다. 필터를 남겨두면 반대로
--   **매장 전체 할일의 알림이 방 밖 담당자에게 안 간다.**
--   개인 할일(private)은 아래 첫 갈래에서 담당자 한 명으로 좁혀지므로 여전히 안전하다.
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
    where w.remind_at is not null
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
    if t.scope = 'private' and t.owner_id is not null then
      v_rec := array[t.owner_id::text];
    else
      select coalesce(array_agg(distinct x), '{}'::text[]) into v_rec
      from public.workers_at(t.unit_id, v_day, t.remind_at) x;
      -- 근무표에 그 시각 근무자가 없으면 매장 전원(fail-open, 0118) — 근무표를 안 쓰는 매장이 다수라
      -- 여기서 닫으면 '전체 할일' 알림이 그 매장에서 통째로 사라진다.
      if coalesce(array_length(v_rec, 1), 0) = 0 then
        select coalesce(array_agg(m.user_id::text), '{}'::text[]) into v_rec
        from public.unit_members m where m.unit_id = t.unit_id;
      end if;
    end if;

    -- ★0126 의 방 필터 블록은 0152 에서 제거됐다(할일에 방 개념이 없어졌다).

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

-- 적용 후 게이트(★넓히는 변경이라 필수):
--   npm run qa:crosstenant   ← 다른 **매장**이 새지 않는지
--   npm run qa:roles · npm run qa:task-reminder
--   수동: A방(직원만)에서 매장 전체 할일 생성 → A방에 없는 사람의 할일 탭에 보이는지
--         개인 할일은 여전히 본인만 보이는지
