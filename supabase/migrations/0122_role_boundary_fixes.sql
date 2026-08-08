-- 0122: 역할 경계 3건 봉합 (2026-08-08 역할 분리 감사)
--
-- 0093(매니저 도입)이 남긴 경계 불일치를 서버 쪽에서 닫는다. 세 건 모두 "같은 매장이면 다 보인다"는
-- 0004~0019 시절의 가정이 역할 축(사장/매니저/직원)으로 안 쪼개진 자리다.
--
--  ① wages_read      : 같은 매장 전원 읽기 → 직원이 동료 시급을 전부 조회할 수 있었다.
--                      (0093 메모의 "기존 갭 ①" — 쓰기만 auth_can_manage() 로 좁혀졌고 읽기는 그대로였다.)
--  ② attendance_read : 같은 이유로 직원이 동료 출퇴근 기록 전체를 조회할 수 있었다.
--  ③ can_see_room()  : 0093 이 wr_select/wrm_* 는 auth_can_manage() 로 넓혔는데 이 함수만 auth_is_owner()
--                      로 남아, 매니저는 **방 목록은 보이는데 그 방 메시지는 0건**인 상태였다(빈 방 무음).
--
-- ★ 클라이언트 영향 확인(변경 전 실측):
--   · 직원 화면의 시급·출퇴근 소비처는 전부 본인 것만 쓴다 —
--     junior/attendance.tsx `records.filter(r => r.staff_id === userId)`, `wages[userId]`,
--     junior/settings·timesheet 동일, useJuniorHomeData 도 본인 필터.
--     → 읽기를 본인+관리자로 좁혀도 화면 회귀 없음(사장·매니저는 auth_can_manage() 로 전량 유지).
--   · ③ 은 순수 가산(매니저에게만 넓어짐) — 사장·직원 동작 무변경.

-- ── ① 시급: 읽기 = 관리자(사장·매니저) 전량 / 직원은 본인 행만 ─────────────
-- 0019 본문 승계(= (select …) 래핑 유지) + 역할 조건만 추가.
drop policy if exists wages_read on public.wages;
create policy wages_read on public.wages
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );

-- ── ② 출퇴근: 읽기 = 관리자 전량 / 직원은 본인 기록만 ─────────────────────
-- 쓰기(insert/update/delete)는 0093 이 이미 같은 술어로 좁혀 놓았다 — 읽기만 맞춘다.
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );

-- ── ③ 방 가시성: 사장 → 관리자(사장·매니저) ───────────────────────────────
-- 0015 본문 그대로, auth_is_owner() → auth_can_manage() 한 줄만 교체.
-- 이 함수는 work_feed·work_templates·work_done 의 SELECT/INSERT/UPDATE 정책이 공유하므로
-- 여기 한 곳을 고치면 매니저의 방 접근이 wr_select(0093)와 같은 기준으로 정렬된다.
create or replace function public.can_see_room(rid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid
      and r.unit_id = public.auth_unit_id()
      and (
        r.is_default
        or public.auth_can_manage()
        or exists (select 1 from public.work_room_members m where m.room_id = r.id and m.user_id = auth.uid())
      )
  )
$$;
