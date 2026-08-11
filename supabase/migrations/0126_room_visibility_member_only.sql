-- 0126_room_visibility_member_only.sql — 방 가시성을 "멤버 기준"으로 통일하고, 푸시에 방 필터를 넣는다 (2026-08-11)
--
-- P5 실측 QA에서 방 격리가 두 군데 더 뚫려 있었다. 둘 다 "누가 그 방을 볼 수 있나"를 재는 자리가
-- **여러 곳에 흩어져 서로 다른 답을 내고 있었던 것**이다.
--
--  ① due_task_reminders() 에 방 술어가 없다 → **비공개 방 업무의 본문이 방 밖 직원의 OS 푸시로 나간다.**
--     0123 이 닫은 출구는 둘(쓰기·인앱 알림)뿐이고 푸시는 my_units_notif_data() 를 타지 않는다.
--     실증: 비기본방의 shared 할일 + 그 방 밖 직원이 근무 중 → out_recipients 에 그 직원이 들어오고
--           out_text(= 업무 본문)가 그대로 실려 나갔다.
--
--  ② 매니저가 **자기가 들어가 있지 않은 방**을 읽고, 자기를 멤버로 넣고, 전체방으로 승격시킬 수 있다.
--     0122 ③ 이 can_see_room() 을 auth_is_owner() → auth_can_manage() 로 넓힌 결과다.
--     그때 고치려던 증상("매니저는 방 목록은 보이는데 메시지 0건")은 실재했지만, 해법이 반대쪽으로 넓었다.
--
-- ★ 확정된 규칙(2026-08-11 사용자 결정) — 이 파일이 이 규칙의 정본이다.
--     · 사장   : 그 매장의 **모든 방**                       (변경 없음)
--     · 매니저 : 기본방 + **본인이 멤버인 방**만              (← 좁아진다)
--     · 직원   : 기본방 + 본인이 멤버인 방                     (변경 없음)
--   매니저는 방을 **만들 수 있고**, 자기가 보는 방에 한해 이름 변경·멤버 관리·**전체방 전환(=전원 초대)**
--   까지 할 수 있다. 못 보는 방은 **아예 만지지 못한다** — 그래서 ②의 승격 우회가 닫힌다.
--
-- ★ 왜 한 파일에서 아홉 곳을 같이 고치나: 이 판정은 함수 2개·정책 5개·알림 함수 1개에 **복제**돼 있다.
--   한 곳만 좁히면 0122 가 고쳤던 "목록은 보이는데 내용은 0건"이 그대로 돌아온다(넓은 쪽이 목록, 좁은 쪽이 내용).
--   가시성은 **can_see_room() 한 판정**을 모두가 참조하게 만들어 다시 갈라지지 않게 한다.
--
-- 성능/보안 분리(db-rls.md): 이 파일은 **보안 변경만** 담는다. (select …) 래핑 등 기존 형태는 그대로 승계.

-- ── 1) 가시성 판정 2개 — 매니저 특권 제거 ──────────────────────────────────
-- can_see_room(rid): "내가" 그 방을 볼 수 있나. 0122 본문에서 auth_can_manage() → auth_is_owner() 한 줄만 되돌린다.
create or replace function public.can_see_room(rid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid
      and r.unit_id = public.auth_unit_id()
      and (
        r.is_default
        or public.auth_is_owner()
        or exists (select 1 from public.work_room_members m where m.room_id = r.id and m.user_id = auth.uid())
      )
  )
$$;

-- user_can_see_room(rid, uid): "지정한 사람이" 그 방을 볼 수 있나(0123). 위와 같은 규칙이어야 한다 —
-- 둘이 갈라지면 "내가 배정할 수 있는 사람"과 "그 사람이 실제로 볼 수 있는 방"이 어긋난다.
create or replace function public.user_can_see_room(rid text, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid
      and (
        r.is_default
        or exists (
          select 1 from public.unit_members um
          where um.unit_id = r.unit_id and um.user_id = uid and um.role = 'owner'
        )
        or exists (
          select 1 from public.work_room_members m
          where m.room_id = r.id and m.user_id = uid
        )
      )
  )
$$;
grant execute on function public.user_can_see_room(text, uuid) to authenticated;

-- ── 2) 방 만든 사람은 그 방의 멤버다 ───────────────────────────────────────
-- 위 ①을 좁히면 **매니저가 자기가 만든 방을 못 보는** 닭-달걀이 생긴다(만든 직후엔 멤버가 아니다).
-- 클라이언트가 자기를 넣게 하지 않고 서버가 보장한다 — 판정을 화면으로 내보내지 않는다(AGENTS.md ③).
-- SECURITY DEFINER: wrm_write 가 can_see_room 을 요구하는데 이 시점엔 아직 false 라 정의자 권한이 필요하다.
-- 사장은 auth_is_owner() 로 이미 전 방을 보므로 멤버 행을 만들지 않는다(명부에 사장이 중복 표시되는 것 방지).
create or replace function public.wr_add_creator_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_default, false) or new.created_by is null then
    return new;
  end if;
  if exists (
    select 1 from public.unit_members m
    where m.unit_id = new.unit_id and m.user_id = new.created_by and m.role = 'owner'
  ) then
    return new;
  end if;
  insert into public.work_room_members (room_id, user_id)
  values (new.id, new.created_by)
  on conflict (room_id, user_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_wr_add_creator_member on public.work_rooms;
create trigger trg_wr_add_creator_member
  after insert on public.work_rooms
  for each row execute function public.wr_add_creator_member();

-- 백필: 이미 있는 비기본방 중 **사장이 아닌 사람이 만든 방**의 생성자를 멤버로 넣는다.
-- 이걸 안 하면 이 마이그레이션 직후 그 사람이 자기 방에서 튕긴다.
insert into public.work_room_members (room_id, user_id)
select r.id, r.created_by
from public.work_rooms r
where not r.is_default
  and r.created_by is not null
  and not exists (
    select 1 from public.unit_members m
    where m.unit_id = r.unit_id and m.user_id = r.created_by and m.role = 'owner'
  )
on conflict (room_id, user_id) do nothing;

-- ── 3) 방·멤버 정책 — 못 보는 방은 아예 못 만진다 ──────────────────────────
-- 0093 본문을 그대로 승계하고 **can_see_room 조건만 덧댄다.**
-- wr_insert 는 손대지 않는다 — 매니저의 '방 만들기'는 그대로 열려 있어야 한다(사용자 확정).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    -- 목록: 매니저 특권 제거. 내용(can_see_room)과 **같은 기준**이어야 "빈 방"이 안 생긴다.
    drop policy if exists wr_select on public.work_rooms;
    create policy wr_select on public.work_rooms
      for select using (
        unit_id = (select public.auth_unit_id())
        and (is_default or (select public.auth_is_owner()) or public.is_room_member(id))
      );

    -- 이름 변경 · 전체방 전환: **보는 방에 한해** 허용.
    -- USING 이 옛 행을 보므로 "못 보던 방을 승격"이 여기서 막힌다. 보는 방을 전체방으로 바꾸는 것(=전원 초대)은 그대로 통과한다.
    drop policy if exists wr_update on public.work_rooms;
    create policy wr_update on public.work_rooms
      for update using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and public.can_see_room(id))
                with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and public.can_see_room(id));

    drop policy if exists wr_delete on public.work_rooms;
    create policy wr_delete on public.work_rooms
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and not is_default
        and public.can_see_room(id)
      );

    -- 멤버 명부: 못 보는 방의 명부는 안 보인다. 본인 행은 지금처럼 항상 보인다.
    drop policy if exists wrm_select on public.work_room_members;
    create policy wrm_select on public.work_room_members
      for select using (
        user_id = (select auth.uid())
        or ((select public.auth_can_manage()) and public.room_in_my_unit(room_id) and public.can_see_room(room_id))
      );

    -- ★핵심: 못 보는 방에 **자기를 밀어넣는** 우회로를 닫는다. 보는 방의 초대·내보내기는 그대로.
    drop policy if exists wrm_write on public.work_room_members;
    create policy wrm_write on public.work_room_members
      for all
      using      ((select public.auth_can_manage()) and public.room_in_my_unit(room_id) and public.can_see_room(room_id))
      with check ((select public.auth_can_manage()) and public.room_in_my_unit(room_id) and public.can_see_room(room_id));
  end if;
end $$;

-- ── 4) my_units_notif_data() — 알림 원천의 방 술어도 같은 규칙으로 ─────────
-- ★정본 재확정(signup-drift ③): 0123 본문 전체를 다시 싣는다. 0123 대비 바뀐 곳은
--   방 술어 3곳의 `my.role in ('owner','manager')` → `my.role = 'owner'` 뿐이다.
--   여기만 넓게 두면 매니저에게 **못 여는 방의 공지·배정이 알림으로 새어 나간다**(위 ①과 같은 부류).
--   관리 전용 분기(uq·sugg·join)는 방과 무관하므로 매니저 포함을 그대로 둔다.
-- ★이 함수는 SECURITY DEFINER 라 RLS 가 안 걸린다 — **방 규칙을 본문이 직접 재현**해야 한다.
--   그래서 feed·template·done 세 분기에 같은 방 술어가 반복된다(복제로 보이지만 한 함수 안의 같은 규칙이다).
--   2026-08-08 이전엔 template 분기에만 이 술어가 빠져 있어 방 밖에서 꽂힌 할 일이 알림으로 새어 나갔다(0123).
--   done(완료마크)까지 거르는 이유: 가려진 할일의 완료마크만 남으면 "무엇에 대한 것인지 알 수 없는 신호"가 되고,
--   존재 자체가 그 방의 존재를 알린다.
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
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id
          and (r.is_default or my.role = 'owner'
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
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where wt.owner_id = me.uid
      and wt.created_by is not null and wt.created_by <> me.uid
      and (wt.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wt.room_id and r.unit_id = wt.unit_id
          and (r.is_default or my.role = 'owner'
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) t where t.rn <= 50

  union all
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and wt.owner_id = me.uid
                  and (wt.room_id is null or exists (
                    select 1 from public.work_rooms r
                    where r.id = wt.room_id and r.unit_id = wt.unit_id
                      and (r.is_default or my.role = 'owner'
                           or exists (select 1 from public.work_room_members rm
                                      where rm.room_id = r.id and rm.user_id = me.uid))
                  )))

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

-- ── 5) due_task_reminders() — 푸시 수신자에 방 필터 ────────────────────────
-- ★정본 재확정: 0118 본문 전체를 다시 싣는다. 0118 대비 바뀐 곳은 **수신자 확정 직후의 방 필터 한 블록**뿐이다.
--   수신자 규칙 SSOT 는 계속 이 함수 하나다 — 엣지·클라로 판정을 복제하지 않는다.
--   room_id is null(방 없는 레거시 할일)은 지금과 똑같이 전원 통과한다.
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

    -- ★2026-08-11 추가: 방 격리. 그 방을 볼 수 없는 사람은 수신자에서 뺀다.
    --   이 필터가 없어서 비공개 방 업무의 **본문**이 방 밖 직원의 잠금화면에 떴다(P5 실측).
    --   위 두 갈래(담당자 지정 / 그 시각 근무자·매장 전원) 어느 쪽으로 왔든 여기서 한 번에 거른다.
    if t.room_id is not null and coalesce(array_length(v_rec, 1), 0) > 0 then
      select coalesce(array_agg(x), '{}'::text[]) into v_rec
      from unnest(v_rec) x
      where public.user_can_see_room(t.room_id, x::uuid);
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

-- 적용 후 게이트:
--   node scripts/tmp-qa-p5-isolation.mjs  (전 7 FAIL → 후 0 FAIL)
--   node scripts/qa-room-isolation.mjs · npm run qa:roles · qa:notify · qa:notif-axis
--   npm run qa:task-reminder · qa:task-knowhow · qa:multistore
