-- 0383_room_main_id_reserved.sql — 전체방 번호(room_main_<매장>)는 전체방만 쓴다 (2026-11-11 · 통합 라이브 적용 CSO 검토에서 발견)
-- 옛 앱 호환: 안전 | 앱이 만드는 일반 방 번호는 genId('room') = 'room_<시각>_<순번>' 이다(src/lib/utils/id.ts · 옛 출시본도 같다).
--   'room_main_' 으로 시작하는 일반 방은 앱이 만든 적이 없다. 전체방 경로(useRoomStore hydrate)는 그대로 통과한다.
--
-- 결함: 0373 wr_insert 는 is_default 인 방만 번호를 묶었다. 일반 방(is_default=false)은 번호가 자유라
--   직원이 id = 'room_main_<매장>' 일반 방을 먼저 넣으면 그 번호(PK)를 차지한다 → 그 매장 전체방을 영영 못 만든다.
--   PK 는 매장을 안 가리므로 다른 매장 사람도 자기 매장 행으로 남의 매장 전체방 번호를 차지할 수 있었다.
--   전체방이 아직 없는 매장(새 매장 · 사장이 첫 진입 전)만 해당한다.
-- 고침: 일반 방은 'room_main_' 으로 시작하는 번호를 못 쓴다. 나머지 술어는 0373 그대로다.
--
-- 베이스 = 0373_one_default_room_per_store.sql wr_insert(그 위 0148:30). 정의 전수: grep "policy wr_insert" supabase/migrations/*.sql
--   0373 머리말(① 전체방 번호는 매장마다 정해진 하나 · ② 클라 insert 는 그 번호로만 전체방을 만든다)이 그대로 유효하다.
-- 되돌리기: 0373 의 wr_insert 를 다시 만든다(마지막 줄만 빠진다).
-- 회귀 검사: scripts/qa-room-matrix.mjs "★일반 방으로 전체방 번호 차지하기(0383 정책)" (수정 전 RED 확인 11-11).

drop policy if exists wr_insert on public.work_rooms;
create policy wr_insert on public.work_rooms
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and (created_by is null or created_by = (select auth.uid()))
    and (not is_default or id = 'room_main_' || unit_id)
    and (is_default or id not like 'room\_main\_%')
  );

-- 자가점검: 정책이 새 술어를 가졌다.
do $$
declare v text;
begin
  select coalesce(with_check, '') into v from pg_policies
   where schemaname = 'public' and tablename = 'work_rooms' and policyname = 'wr_insert';
  -- 저장된 글에서 not like 는 !~~ 로 보인다. 옛 줄(id = 'room_main_' || unit_id)에는 없다.
  if strpos(v, '!~~') = 0 then
    raise exception '0383 자가점검 실패: wr_insert 에 일반 방 번호 제한이 없다 (%)', v;
  end if;
  raise notice '0383 자가점검 통과: wr_insert 일반 방은 room_main_ 번호를 못 쓴다';
end $$;
