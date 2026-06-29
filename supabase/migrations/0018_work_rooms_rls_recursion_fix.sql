-- 0018_work_rooms_rls_recursion_fix.sql
-- 버그: work_rooms ↔ work_room_members 의 SELECT 정책이 서로의 테이블을 (RLS 켜진 채) 직접 참조 →
--       상호 무한재귀로 Postgres 가 42P17 ("infinite recursion detected in policy") 거부.
--       증상: GET /work_rooms, /work_room_members 가 500 → fetchRooms() 가 [] 폴백 →
--             방 선택 바 소실 + WorkBoard 가 기본방 재생성 시도(POST 409 duplicate key).
-- 원인: 0015 의 wr_select 가 work_room_members 를, wrm_select 가 work_rooms 를 직접 exists() 참조.
-- 해법: 교차 참조를 SECURITY DEFINER 함수로 감싼다(함수 내부는 RLS 우회 → 재귀 차단).
--       0015 의 can_see_room() 과 동일한 패턴. 가시성 규칙(의미)은 그대로 보존한다.

-- 내 방 멤버십 확인 (정의자 권한 → work_room_members 의 RLS 우회)
create or replace function public.is_room_member(rid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_room_members m
    where m.room_id = rid and m.user_id = auth.uid()
  )
$$;

-- 방이 내 매장 소속인지 확인 (정의자 권한 → work_rooms 의 RLS 우회)
create or replace function public.room_in_my_unit(rid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid and r.unit_id = public.auth_unit_id()
  )
$$;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    -- work_rooms SELECT: 멤버 확인을 정의자 함수로 (직접 work_room_members 참조 제거)
    drop policy if exists wr_select on public.work_rooms;
    create policy wr_select on public.work_rooms
      for select using (
        unit_id = public.auth_unit_id()
        and (is_default or public.auth_is_owner() or public.is_room_member(id))
      );

    -- work_room_members SELECT: 방-매장 확인을 정의자 함수로 (직접 work_rooms 참조 제거)
    drop policy if exists wrm_select on public.work_room_members;
    create policy wrm_select on public.work_room_members
      for select using (
        user_id = auth.uid()
        or (public.auth_is_owner() and public.room_in_my_unit(room_id))
      );

    -- work_room_members 쓰기(추가/삭제)=사장만. 0015 와 동일하나 work_rooms 직접참조를 정의자 함수로 교체.
    drop policy if exists wrm_write on public.work_room_members;
    create policy wrm_write on public.work_room_members
      for all
      using      (public.auth_is_owner() and public.room_in_my_unit(room_id))
      with check (public.auth_is_owner() and public.room_in_my_unit(room_id));
  end if;
end $$;
