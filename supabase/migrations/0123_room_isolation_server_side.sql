-- 0123_room_isolation_server_side.sql — 방(room) 격리를 **서버 쪽에서** 닫는다 (2026-08-08)
--
-- 지금까지 방 격리는 "그 방을 볼 수 있는 사람만 그 방 것을 읽는다"까지만 서버가 막고 있었다.
-- 빠진 것은 **꽂아 넣는 쪽**이다. 화면은 막혀 있지만 서버는 뚫려 있었다:
--
--  ① work_templates INSERT/UPDATE — 담당자(owner_id)가 그 방을 볼 수 있는지 **전혀 검사하지 않았다.**
--     사장이 방 밖 직원에게 개인 할 일을 꽂아 넣을 수 있고, 그 직원은 자기 목록에서 그 할 일을 보는데
--     정작 그 방·맥락에는 접근할 수 없다. (INSERT만 막으면 owner_id=null 로 넣고 UPDATE 로 바꾸면
--     그만이라 두 경로를 같이 닫는다 — 한쪽만 닫는 것은 닫은 게 아니다.)
--  ② my_units_notif_data() 의 'template'·'done' 분기 — **방 필터가 없었다.**
--     이 함수는 SECURITY DEFINER(RLS 우회)라 방 규칙을 본문이 직접 재현해야 하는데,
--     같은 함수의 'feed' 분기는 재현하고 있고 이 두 분기만 빠져 있었다.
--     결과: 방 밖에서 꽂힌 할 일이 그대로 알림으로 나간다(①의 출구).
--
-- 의미 보존 원칙: 기존 술어는 1mm도 바꾸지 않고 **조건만 AND 로 덧댄다.**
--   · can_see_room(rid) 의 의미는 0122 판본(기본방 or 관리자 or 방멤버)을 그대로 따른다.
--   · 새 헬퍼는 그 판정을 **'나' 대신 '지정한 사람'** 에게 물을 수 있게 한 것뿐이다.
-- 성능/보안 분리 원칙(db-rls.md): 이 파일은 **보안 변경만** 담는다.

-- ── 1) 헬퍼: 지정한 사용자가 그 방을 볼 수 있나 ──────────────────────────────
-- can_see_room() 은 auth.uid() 고정이라 "남이 볼 수 있나"를 못 묻는다. 그래서 uid 를 인자로 받는 짝을 만든다.
-- 판정 규칙은 0122 can_see_room 과 동일: 기본방 이거나 · 그 매장의 관리자(사장/매니저)거나 · 그 방의 멤버.
-- SECURITY DEFINER: work_rooms/work_room_members 의 RLS 를 우회해야 정책 안에서 재귀 없이 쓸 수 있다(0018 패턴).
create or replace function public.user_can_see_room(rid text, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid
      and (
        r.is_default
        or exists (
          select 1 from public.unit_members um
          where um.unit_id = r.unit_id and um.user_id = uid and um.role in ('owner', 'manager')
        )
        or exists (
          select 1 from public.work_room_members m
          where m.room_id = r.id and m.user_id = uid
        )
      )
  )
$$;
grant execute on function public.user_can_see_room(text, uuid) to authenticated;

-- ── 2) work_templates INSERT/UPDATE — 담당자도 그 방을 볼 수 있어야 한다 ─────
-- 0019 본문(= (select …) 래핑 + can_see_room)을 그대로 두고 담당자 조건만 덧댄다.
-- owner_id is null(공용 할 일) 과 owner_id = 나(내 개인 할 일) 는 지금과 똑같이 통과한다 —
-- 새로 막히는 것은 **"남에게, 그 남이 못 보는 방에"** 꽂는 경우 하나뿐이다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists wt_insert on public.work_templates;
    create policy wt_insert on public.work_templates
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (room_id is null or public.can_see_room(room_id))
        and (
          room_id is null
          or owner_id is null
          or owner_id = (select auth.uid())
          or public.user_can_see_room(room_id, owner_id)
        )
      );

    drop policy if exists wt_update on public.work_templates;
    create policy wt_update on public.work_templates
      for update using (
        unit_id = (select public.auth_unit_id())
        and (room_id is null or public.can_see_room(room_id))
      )
      with check (
        unit_id = (select public.auth_unit_id())
        and (room_id is null or public.can_see_room(room_id))
        and (
          room_id is null
          or owner_id is null
          or owner_id = (select auth.uid())
          or public.user_can_see_room(room_id, owner_id)
        )
      );
  end if;
end $$;

-- ── 3) my_units_notif_data() — 'template'·'done' 분기에 방 필터 ───────────────
-- ★정본 재확정(signup-drift 규칙 ③): 흩어진 재정의는 **항상 최고 번호 파일이 최종본**이어야 하므로
--   0093 본문 전체를 여기 다시 싣는다. 0093 대비 바뀐 곳은 아래 두 분기의 room 조건뿐이다.
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as ( -- 내가 멤버인 매장 + 그 매장에서의 역할(관리 전용 원천 게이트)
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  -- 피드: 공지 전부(읽음 이력 포함) + 나를 @멘션한 글. 방 격리(0015 의미) 준수.
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
          and (r.is_default or my.role in ('owner', 'manager')
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  -- 교대: 열림/수락(승인대기)/확정/반려 — 클라 술어(isIncomingSwap 등)의 입력 상위집합.
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
  -- 배정: 남이 나에게 배정한 할일(오늘 발생 여부·완료 판정은 클라 occursOn/done).
  -- ★2026-08-08 추가: 방 필터. 위 feed 분기와 **같은 술어**다 — 이 함수는 SECURITY DEFINER 라
  --   RLS 가 안 걸리므로 방 규칙을 본문이 직접 재현해야 하는데 이 분기만 빠져 있었다.
  --   그래서 방 밖에서 꽂힌 할 일이 알림으로 새어 나갔다(위 ①의 출구).
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
          and (r.is_default or my.role in ('owner', 'manager')
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) t where t.rn <= 50

  union all
  -- 완료마크: 오늘(KST) 것만 — 배정 미완료 판정(isPendingAssignment) 입력.
  -- ★2026-08-08 추가: 같은 방 필터. 위 분기에서 가려진 할일의 완료마크만 남으면
  --   "무엇에 대한 것인지 알 수 없는 신호"가 되고, 존재 자체가 그 방의 존재를 알린다.
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
                      and (r.is_default or my.role in ('owner', 'manager')
                           or exists (select 1 from public.work_room_members rm
                                      where rm.room_id = r.id and rm.user_id = me.uid))
                  )))

  union all
  -- 멤버 이름: nameOf(배정자·교대 요청자 표기)용. 소속 매장 명부는 스토어(useStaffStore)와 동일 노출 범위.
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- 관리 전용: 답변 대기 질문(0060 owner_overview pending_q 와 동일 상태 리터럴).
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id and my.role in ('owner', 'manager')
    where uq.status = 'pending_owner_answer'
  ) q where q.rn <= 50

  union all
  -- 관리 전용: 검토 대기 제안.
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id and my.role in ('owner', 'manager')
    where ps.status = 'pending'
  ) g where g.rn <= 50

  union all
  -- 관리 전용: 합류 승인 대기(profiles.pending_unit_id = 내 관리 매장).
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null
$$;
grant execute on function public.my_units_notif_data() to authenticated;

-- 적용 후 게이트: node scripts/qa-room-isolation.mjs (전=FAIL 후=PASS 실증) → qa:roles → qa:notify.
