-- 0077_cross_store_notif_data.sql — 통합 알림(cross-store) 원천 데이터 RPC
--
-- ── 배경(§수정은 전체 아키텍처 안전하게 ①) ─────────────────────────────────────
-- 알림 원천 테이블(work_feed·work_templates·work_done·swap_requests·unknown_queries·
--   playbook_suggestions·profiles.pending_unit_id)의 SELECT 정책은 전부 활성 매장
--   (auth_unit_id()) 단일 스코프다. 직원/사장이 여러 매장에 속해도 "다른 소속 매장의 알림"을
--   클라가 읽을 경로가 원천 부재 → stores 허브 카드 뱃지·전체 매장 알림 리스트가 불가능했다.
--
-- ── 처방(SSOT·§②) — "원시 행 반환, 판정은 클라" ─────────────────────────────────
-- 안읽음/대기 판정 술어는 클라 notifications.ts 가 SSOT 이고, 특히 배정 알림은 occursOn(반복
--   규칙)에 의존한다. occursOn 의 SQL 복제는 0074 에서 드리프트 위험으로 기각한 선례가 있다.
--   → 이 RPC 는 판정하지 않는다. 소속 매장별 "원시 행"만 돌려주고, 클라가 매장별로 기존
--   juniorUnreadCount/buildJuniorNotifications(사장은 owner 판)을 그대로 돌린다(술어 복제 0).
--   WHERE 는 클라 술어의 입력 확보용 상위집합 프리필터만(공지 전부·나를 멘션·내게 배정 등).
--
-- ── 격리/보안(db-rls 규칙) ──────────────────────────────────────────────────────
-- definer 로 RLS 를 우회하므로 모든 분기가 unit_members(user_id=auth.uid()) 조인으로 시작한다
--   — 비소속 매장 행은 구조적으로 반환 불가. 사장 전용 원천(질문·제안·합류신청)은 m.role='owner'
--   매장만. work_feed 는 방 격리(0015 can_see_room 의미)를 매장별 역할로 인라인 재현한다
--   (can_see_room 자체는 auth_unit_id() 고정이라 타 매장에 못 씀). 인자 없음 → 주입면 없음.
-- 볼륨 캡: 피드·교대 최근 30일 & 매장당 50행, 나머지도 매장당 50행(클라 MAX_NOTIFS=50 정합).

create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as ( -- 내가 멤버인 매장 + 그 매장에서의 역할(사장 전용 원천 게이트)
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
          and (r.is_default or my.role = 'owner'
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  -- 교대: 열림/수락(사장 승인대기)/확정/반려 — 클라 술어(isIncomingSwap 등)의 입력 상위집합.
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
  -- 완료마크: 오늘(KST) 것만 — 배정 미완료 판정(isPendingAssignment) 입력.
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and wt.owner_id = me.uid)

  union all
  -- 멤버 이름: nameOf(배정자·교대 요청자 표기)용. 소속 매장 명부는 스토어(useStaffStore)와 동일 노출 범위.
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- 사장 전용: 답변 대기 질문(0060 owner_overview pending_q 와 동일 상태 리터럴).
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id and my.role = 'owner'
    where uq.status = 'pending_owner_answer'
  ) q where q.rn <= 50

  union all
  -- 사장 전용: 검토 대기 제안.
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id and my.role = 'owner'
    where ps.status = 'pending'
  ) g where g.rn <= 50

  union all
  -- 사장 전용: 합류 승인 대기(profiles.pending_unit_id = 내 사장 매장).
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role = 'owner'
  where p.deleted_at is null
$$;

grant execute on function public.my_units_notif_data() to authenticated;
