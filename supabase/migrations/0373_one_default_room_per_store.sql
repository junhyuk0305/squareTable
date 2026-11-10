-- 0373: 매장마다 전체방은 하나다(카카오톡 원리 · 2026-11-10 사용자 결정)
--
-- ── 고치는 것 ──────────────────────────────────────────────────────────────
-- 방 만들기 정책 wr_insert(최고 0148:30)는 "자기 매장 · 만든 사람 = 나"만 봤다.
-- 그래서 직원 누구나 앱을 거치지 않고 is_default = true 방을 다른 번호로 새로 만들 수 있었다.
-- 그 방은 전원에게 보이고(can_see_room 0285:296 의 is_default 단락) 지울 수도 없다(wr_delete 가 not is_default).
--
-- ── 규칙 ───────────────────────────────────────────────────────────────────
--   ① 전체방 번호는 매장마다 정해진 하나 = 'room_main_' || unit_id
--      (앱 useRoomStore.ts defaultRoomId · 0015 backfill 과 같은 규칙. 옛 앱도 이 번호만 만든다.)
--   ② 클라이언트 insert 는 전체방이면 그 번호여야 한다(wr_insert). id 가 PK 라 클라 경로로는 둘이 못 생긴다.
--   ③ 서버 쪽(정의자·서비스 권한) 실수까지 막으려고 매장당 전체방 하나를 부분 유일 색인으로 건다.
--   수정(update)은 0319 가 열 권한(name·image_url·color)으로 이미 막았다. is_default 를 바꾸는 길은 없다.
--
-- ── 옛 앱과 같이 ──────────────────────────────────────────────────────────
-- 앱이 만드는 전체방은 ① 번호뿐이다. 이미 있으면 PK 충돌로 끝나던 것과 같다(useRoomStore 는 실패를 무시).
-- 적용 전 실측(11-10): 라이브 전체방 14 · 전부 ① 번호 · 매장당 최대 1 · 지운 전체방 0. 로컬도 같음.

-- 색인 전에 중복이 있으면 여기서 멈춘다(조용히 지우지 않는다).
do $$
begin
  if exists (select 1 from public.work_rooms where is_default group by unit_id having count(*) > 1) then
    raise exception 'default_room_duplicate_exists';
  end if;
end $$;

create unique index if not exists work_rooms_one_default_per_unit
  on public.work_rooms (unit_id) where is_default;

-- wr_insert 본문 = 0148:30 그대로 + ②.
drop policy if exists wr_insert on public.work_rooms;
create policy wr_insert on public.work_rooms
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and (created_by is null or created_by = (select auth.uid()))
    and (not is_default or id = 'room_main_' || unit_id)
  );
