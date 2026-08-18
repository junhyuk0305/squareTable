-- 0147_room_membership_only.sql — 방은 **멤버십으로만** 보인다 (사장 자동참여 폐지)
--
-- ── 배경 ───────────────────────────────────────────────────────────────────
-- 지금까지 사장은 매장의 **모든 방**을 자동으로 봤다(0015 can_see_room 의 `or auth_is_owner()`).
-- 그래서 직원들이 자기들끼리 쓸 방을 만들 이유가 없었고, 업무 채팅이 카카오톡을 대신할 수 없었다.
-- 카톡과 같은 규칙으로 바꾼다: **내가 들어간 방만 보인다.** 사장도 예외가 아니다.
--   · 사장도 초대받거나 직접 만든 방만 본다.
--   · 기본방('전체')은 그대로 매장 전원 자동 참여(공지 전달 경로가 여기 하나뿐이다).
--
-- ── 왜 한 파일에서 여섯 곳을 같이 고치나 ────────────────────────────────────
-- 0126 이 남긴 교훈 그대로다: 이 판정은 함수 2개·정책 2개·트리거 1개·알림 함수 1개에 복제돼 있고,
--   한 곳만 고치면 "목록은 보이는데 내용은 0건"(또는 그 반대)이 된다.
--   ★특히 my_units_notif_data() 는 SECURITY DEFINER 라 RLS 가 안 걸린다 — 방 규칙을 본문이 직접
--     재현해야 하고, 그래서 feed·template·done 세 분기에 같은 술어가 반복된다.
--
-- ── ★백필이 같은 파일에 있어야 하는 이유 ───────────────────────────────────
-- 판정만 바꾸고 끝내면 **배포되는 순간 사장이 자기 매장의 모든 방에서 튕긴다.**
--   사장은 지금까지 auth_is_owner() 로 통과했기 때문에 work_room_members 에 행이 아예 없다
--   (0126 이 "명부에 사장이 중복 표시되는 것 방지"로 일부러 안 만들었다).
--   그래서 §7 에서 기존 비기본방 전부에 그 매장 사장을 멤버로 넣는다. 이건 되돌릴 수 없는 순간이라
--   판정 변경과 반드시 같은 트랜잭션이어야 한다.
--
-- ── soft delete 준비 ───────────────────────────────────────────────────────
-- 방 삭제는 DB 에서 지우지 않고 UI 에서만 사라지게 한다(대화·공지·완료 기록 보존).
--   여기서는 컬럼 추가 + 가시성 판정 반영까지만 한다. 삭제 RPC 는 0148.
--   ★판정을 두 번 고치지 않으려고 컬럼을 이 파일에서 미리 추가한다.

-- ── 1) soft delete 컬럼 ────────────────────────────────────────────────────
alter table public.work_rooms add column if not exists deleted_at timestamptz;
create index if not exists idx_wr_alive on public.work_rooms (unit_id) where deleted_at is null;

comment on column public.work_rooms.deleted_at is
  '방 삭제(0147/0148): UI 에서만 사라지고 행·대화·완료기록은 보존된다. null 이면 살아 있는 방.';

-- ── 2) 가시성 판정 2개 — 사장 특권 제거 + 삭제된 방 배제 ────────────────────
-- can_see_room(rid): "내가" 그 방을 볼 수 있나. 0126 본문에서 `or auth_is_owner()` 한 줄을 뺀다.
-- ★이 함수는 work_feed 의 RLS 가 계속 쓴다(대화·공지는 방의 것이다). 0152 에서 할일만 떼어낼 때도
--   이 함수 본문은 건드리지 않는다 — 정책 쪽에서 조건을 빼는 방식으로 한다.
create or replace function public.can_see_room(rid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid
      and r.unit_id = public.auth_unit_id()
      and r.deleted_at is null
      and (
        r.is_default
        -- ★ or public.auth_is_owner()  ← 0147 에서 제거. 사장도 멤버여야 본다.
        or exists (select 1 from public.work_room_members m where m.room_id = r.id and m.user_id = auth.uid())
      )
  )
$$;

-- user_can_see_room(rid, uid): "지정한 사람이" 그 방을 볼 수 있나(0123/0127).
-- 위와 같은 규칙이어야 한다 — 둘이 갈라지면 "내가 배정할 수 있는 사람"과 "그 사람이 실제로 볼 수
-- 있는 방"이 어긋난다. 0127 의 매장 소속 검사(C1 방어)는 그대로 승계한다.
create or replace function public.user_can_see_room(rid text, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    join public.unit_members um on um.unit_id = r.unit_id and um.user_id = uid
    where r.id = rid
      and r.deleted_at is null
      and (
        r.is_default
        -- ★ or um.role = 'owner'  ← 0147 에서 제거.
        or exists (select 1 from public.work_room_members m where m.room_id = r.id and m.user_id = uid)
      )
  )
$$;
grant execute on function public.user_can_see_room(text, uuid) to authenticated;

-- ── 3) 방 생성자는 그 방의 멤버다 — 사장 예외 제거 ─────────────────────────
-- 0127 본문 승계 + "사장이면 멤버 행을 만들지 않는다" 분기만 제거한다.
-- 이제 사장도 멤버여야 방을 보므로, 그 예외를 남겨두면 **자기가 만든 방을 자기가 못 본다.**
create or replace function public.wr_add_creator_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_default, false) or new.created_by is null then
    return new;
  end if;
  -- 생성자가 그 매장 사람인지 확인(0127 C2 방어 — 이 트리거는 SECURITY DEFINER 라 스스로 검증해야 한다).
  if not exists (
    select 1 from public.unit_members m
    where m.unit_id = new.unit_id and m.user_id = new.created_by
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

-- ── 4) 방 목록·명부 정책 ───────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    -- 목록: 사장 특권 제거 + 삭제된 방 배제. 내용(can_see_room)과 **같은 기준**이어야 빈 방이 안 생긴다.
    drop policy if exists wr_select on public.work_rooms;
    create policy wr_select on public.work_rooms
      for select using (
        unit_id = (select public.auth_unit_id())
        and deleted_at is null
        and (is_default or public.is_room_member(id))
      );

    -- 멤버 명부: **그 방을 보는 사람이면 그 방 명부 전체**를 본다(전엔 관리자만 볼 수 있어서
    -- 직원은 "참여 인원 3명"이라 쓰여 있는데 목록엔 자기 하나만 뜨는 상태였다).
    -- 본인 행은 지금처럼 항상 보인다(내가 어느 방에 속했는지는 알아야 한다).
    drop policy if exists wrm_select on public.work_room_members;
    create policy wrm_select on public.work_room_members
      for select using (
        user_id = (select auth.uid())
        or (public.room_in_my_unit(room_id) and public.can_see_room(room_id))
      );
  end if;
end $$;

-- ── 5) 알림 원천의 방 술어도 같은 규칙으로 ────────────────────────────────
-- ★정본 재확정: 0126 본문 전체를 다시 싣는다. 0126 대비 바뀐 곳은
--   방 술어 3곳(feed·template·done)의 `my.role = 'owner' or` 제거와 `r.deleted_at is null` 추가뿐이다.
--   여기만 넓게 두면 **사장에게 못 여는 방의 공지·배정이 알림으로 새어 나간다.**
--   관리 전용 분기(uq·sugg·join)는 방과 무관하므로 그대로 둔다.
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
        where r.id = wt.room_id and r.unit_id = wt.unit_id and r.deleted_at is null
          and (r.is_default
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
                    where r.id = wt.room_id and r.unit_id = wt.unit_id and r.deleted_at is null
                      and (r.is_default
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

-- ── 6) ★백필 — 기존 비기본방 전부에 그 매장 사장을 멤버로 넣는다 ──────────
-- 이게 없으면 이 마이그레이션이 적용되는 순간 사장이 자기 매장의 모든 방에서 튕긴다.
-- 지금까지의 동작(사장은 전부 본다)을 데이터로 고정시키는 것이라, 기존 사용자 입장에서는
-- 아무것도 바뀌지 않는다. 바뀌는 것은 **앞으로 만들어지는 방**부터다.
insert into public.work_room_members (room_id, user_id)
select r.id, m.user_id
from public.work_rooms r
join public.unit_members m on m.unit_id = r.unit_id and m.role = 'owner'
where not r.is_default
  and r.deleted_at is null
on conflict (room_id, user_id) do nothing;

-- 적용 후 게이트:
--   npm run qa:roles · npm run qa:crosstenant
--   수동: 사장이 안 들어간 방을 하나 만들어 두고, 그 방이 사장 목록에서 안 보이는지 확인
