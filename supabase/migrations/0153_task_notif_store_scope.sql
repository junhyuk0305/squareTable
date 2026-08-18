-- 0153_task_notif_store_scope.sql — 할일 알림도 매장 기준으로 (0152 의 마무리)
--
-- 0152 가 할일에서 방 격리를 걷어냈다. 그런데 **알림 경로 두 곳**이 아직 방을 본다.
-- 방향이 갈리면 "할일은 보이는데 알림은 안 온다"(또는 그 반대)가 된다.
--
-- ── ① due_task_reminders() — 0152 가 열어버린 구멍을 다시 막는다 ★보안 ──────
-- 0126/0127 이 이 함수에 **방 필터**를 넣어 막고 있던 것이 하나 있다(0127 C1):
--     사장이 기본방 할일의 owner_id 에 **생판 남의 uuid** 를 넣고 remind_at 을 걸면
--     → 이 함수가 그를 수신자로 돌려주고
--     → 엣지 deliver() 는 수신자의 매장 소속을 검사하지 않으므로
--     → **플랫폼의 임의 사용자에게 공격자가 쓴 본문이 푸시된다.**
-- 0152 에서 방 필터를 빼자 이 벡터가 그대로 되살아났다(qa:room-cso P2 실측).
--
-- 방 필터로 되돌리지 않는다 — 할일에 방 개념이 없다는 원칙이 먼저다.
-- 대신 **매장 소속 필터**로 막는다. "방 격리는 뺐지만 매장 격리는 남는다"는 0152 의 원칙과
-- 정확히 같은 선이고, 정상 경로(그 매장 사람에게 배정)는 1mm도 안 좁아진다.
--
-- ── ② my_units_notif_data() — template·done 분기의 방 술어 제거 ────────────
-- 할일이 매장 전체가 됐으므로 "나에게 배정된 할일"과 그 완료마크는 방과 무관하게 알림에 나와야 한다.
-- ⛔ feed 분기(메시지·공지)의 방 술어는 **그대로 둔다** — 대화와 공지는 방의 것이다.

-- ── ① 수신자를 그 매장 사람으로 한정 ──────────────────────────────────────
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

    -- ★매장 소속 필터(0153). 0126 의 방 필터를 대신한다 — 할일엔 방 개념이 없지만(0152)
    --   **매장 경계는 그대로**다. owner_id 에 아무 uuid 나 꽂아 임의 사용자에게 푸시를 보내는
    --   경로(0127 C1)를 여기서 닫는다. 위 두 갈래 어느 쪽으로 왔든 한 번에 거른다.
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

-- ── ② 알림 원천: 할일(template)·완료(done) 분기의 방 술어 제거 ────────────
-- ★정본 재확정: 0147 본문 전체를 다시 싣는다. 바뀐 곳은 template·done 두 분기의 방 술어 제거뿐이다.
--   feed 분기는 그대로 — 메시지·공지는 방의 것이다.
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as (
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  select f.unit_id, 'feed'::text, f.data
  from (
    select wf.unit_id, wf.data,
           row_number() over (partition by wf.unit_id order by wf.created_at desc) as rn
    from public.work_feed wf
    join my on my.unit_id = wf.unit_id
    cross join me cross join kst
    where wf.feed_date >= kst.since
      and (wf.data->>'kind' = 'notice' or wf.data->'mentions' ? me.uid::text)
      -- ⛔ 대화·공지는 방의 것이다 — 이 술어는 유지한다.
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id and r.deleted_at is null
          and (r.is_default
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  select s.unit_id, 'swap'::text, s.payload
  from (
    select sr.unit_id, to_jsonb(sr) as payload,
           row_number() over (partition by sr.unit_id order by sr.created_at desc) as rn
    from public.swap_requests sr
    join my on my.unit_id = sr.unit_id
    where sr.status in ('open', 'accepted', 'approved', 'rejected')
      and sr.created_at >= now() - interval '30 days'
  ) s where s.rn <= 50

  union all
  -- ★할일: 방 술어 제거(0153). 나에게 배정된 할일은 방과 무관하게 알림에 나온다.
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where wt.owner_id = me.uid
      and wt.created_by is not null and wt.created_by <> me.uid
  ) t where t.rn <= 50

  union all
  -- ★완료마크: 같은 이유로 방 술어 제거(0153).
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and wt.owner_id = me.uid)

  union all
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id and my.role in ('owner', 'manager')
    where uq.status = 'pending_owner_answer'
  ) q where q.rn <= 50

  union all
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id and my.role in ('owner', 'manager')
    where ps.status = 'pending'
  ) g where g.rn <= 50

  union all
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null
$$;
grant execute on function public.my_units_notif_data() to authenticated;

-- 적용 후 게이트:
--   npm run qa:room-cso   ← P2(임의 사용자 푸시)가 다시 막혔는지 ★필수
--   npm run qa:notify · qa:notif-axis · qa:task-reminder
