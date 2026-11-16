-- 0720_default_room_server.sql — 매장이 생기면 서버가 전체방(기본 방)을 만든다 · 없는 매장 백필
--   (2026-11-16 · 결함 전수 점검 결정 U-3 · 찾은결함 7)
-- 옛 앱 호환: 안전 | 표·열·제약·함수 서명 변경 없음. 트리거 하나와 백필뿐이다.
--   옛 앱(1.1.1)의 useRoomStore.hydrate 는 방 목록을 먼저 읽고 전체방이 없을 때만 insert 한다.
--   서버가 이미 만들었으니 옛 앱은 그 방을 읽고 insert 하지 않는다. 읽기 전에 insert 하는 길은 없다.
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────
--   전체방(work_rooms.is_default · 매장마다 하나 · 0373 work_rooms_one_default_per_unit)을 사장 클라만 만들었다.
--   사장이 앱을 다시 열기 전에 직원이 합류하면 방이 없다. 라이브 실매장 3곳이 이 상태였다(11-12 실측 · 셋 다 직원 0).
--   하니스가 create_store 로 만든 QA 매장 54개도 같았다.
--
-- ── 정한 것 ─────────────────────────────────────────────────────────────────
--   ① create_store 본문(0600)을 다시 쓰지 않고 units AFTER INSERT 트리거로 만든다.
--      매장이 생기는 길(create_store · service_role 시드·하니스)이 모두 같은 규칙을 탄다. 가입 함수 드리프트 위험도 없다(signup-drift.md).
--      kind = 'store' 만이다. 공간(space · 0375)과 본사 작업실(brand_workspace · 0209)은 업무 채팅방을 쓰지 않는다.
--   ② 번호 = 'room_main_' || unit_id · 이름 '전체' · 만든 사람 = 매장 사장. 앱 defaultRoomId · 0015 백필 · 0373 wr_insert 와 같은 규칙이다.
--      on conflict do nothing: 같은 번호(PK)나 같은 매장의 전체방(0373 색인)이 이미 있으면 그대로 둔다.
--   ③ 합류(_admit_member) 때 만드는 길은 두지 않는다. 지금 없는 매장은 ④ 백필이 채우고, 새 매장은 ① 이 만든다.
--   ④ 백필 = 전체방이 없는 살아 있는 매장 전부(실매장 3곳 + QA 매장). 지운 매장(deleted_at · purged_at)은 건드리지 않는다.
--
-- 되돌리기: scripts/rollback/0720.sql (트리거만 지운다 · 백필한 방은 남긴다. 클라가 만들던 것과 같은 방이다)

create or replace function public.tg_units_default_room()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.work_rooms (id, unit_id, name, is_default, created_by)
  values ('room_main_' || new.id, new.id, '전체', true, new.owner_id)
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.tg_units_default_room() from public, anon, authenticated;

drop trigger if exists trg_units_default_room on public.units;
create trigger trg_units_default_room
  after insert on public.units
  for each row when (new.kind = 'store')
  execute function public.tg_units_default_room();

-- ④ 백필
insert into public.work_rooms (id, unit_id, name, is_default, created_by)
select 'room_main_' || u.id, u.id, '전체', true, u.owner_id
  from public.units u
 where u.kind = 'store' and u.deleted_at is null and u.purged_at is null
   and not exists (select 1 from public.work_rooms r where r.unit_id = u.id and r.is_default)
on conflict do nothing;

-- ── 자가점검 ──
do $$
declare v_left int;
begin
  select count(*) into v_left from public.units u
   where u.kind = 'store' and u.deleted_at is null and u.purged_at is null
     and not exists (select 1 from public.work_rooms r where r.unit_id = u.id and r.is_default);
  -- 남는 매장 = 전체방 번호를 다른 매장이 일반 방으로 이미 차지한 경우뿐이다(0383 이 막기 전 행). 0 이 아니면 알린다.
  if v_left > 0 then raise warning '0720: 전체방이 없는 매장 % 곳(번호 충돌 · 손으로 본다)', v_left; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_units_default_room' and not tgisinternal) then
    raise exception '0720: 트리거가 없다';
  end if;
end $$;
