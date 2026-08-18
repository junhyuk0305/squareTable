-- 0149_room_prefs_and_appearance.sql — 방 사진·색 + (사용자 × 방) 개인 설정
--
-- ── 배경 ───────────────────────────────────────────────────────────────────
-- 카카오톡 규칙을 그대로 따른다: **만들 때 정한 이름·사진은 전원에게 보이고, 나중에 고치면
--   나에게만 적용된다.** 이건 UI 규칙이 아니라 데이터가 두 층이어야 한다는 뜻이다.
--     · 전역: work_rooms.name / image_url / color   ← 만들 때 한 번
--     · 개인: work_room_prefs.*                      ← 이후 변경은 전부 여기
--   화면은 `prefs?.x ?? room.x` 로 합성한다.
--
-- 왜 전역 이름을 아무나 못 고치게 하나: 변경이 전원에게 퍼지면 누군가 "주방"을 "ㅋㅋㅋ"로 바꿨을 때
--   되돌릴 사람과 근거가 필요해진다. 카톡이 개인 적용으로 푼 이유가 그것이다.
--   (0148 의 wr_update 는 열려 있지만 앱은 만들 때 외에는 그 경로를 쓰지 않는다.)
--
-- ── 선례 ───────────────────────────────────────────────────────────────────
-- unit_member_prefs(0076) 가 이미 (사용자 × 매장) 축의 개인 설정을 담고 있다 — 매장 별칭·색·음소거.
--   이 테이블은 그 패턴을 (사용자 × 방) 축으로 복제한 것이라 RLS 형태가 같다.
--   ★muted 는 넣지 않는다 — 매장별 음소거가 0076 에 이미 있어 축이 겹친다.

-- ── 1) 전역 외형 ───────────────────────────────────────────────────────────
alter table public.work_rooms add column if not exists image_url text;
alter table public.work_rooms add column if not exists color text
  check (color is null or char_length(color) <= 16);

comment on column public.work_rooms.color is
  '방 색(0149): 사진이 없을 때 아바타 배경. 팔레트는 클라의 CategoryColors 재사용 — 형식 검증은 클라(느슨 저장).';

-- ── 2) 개인 덮어쓰기 + 방별 개인 설정 ─────────────────────────────────────
create table if not exists public.work_room_prefs (
  room_id        text not null references public.work_rooms (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- 개인 덮어쓰기. null = 전역 값(work_rooms) 사용. 되돌리기 = 이 행을 지우거나 null 로.
  name           text check (name is null or char_length(name) <= 20),
  image_url      text,
  color          text check (color is null or char_length(color) <= 16),
  -- 이 방의 '할일 완료' 알림을 내 채팅에 띄울지.
  -- ★개인 축인 이유: 방 속성으로 두면 한 사람이 끄는 순간 전원의 채팅에서 완료 알림이 사라지고,
  --   "누가 껐지?"를 추적할 자리가 필요해진다. 개인 축이면 그 문제가 아예 없다.
  --   할일은 사람에게 배정되므로 담당자가 여러 방에 있으면 완료 알림이 여러 곳에 뜰 수 있는데,
  --   그 중복을 사용자가 스스로 끄는 것이 이 스위치의 본래 목적이다.
  show_task_done boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists idx_wrp_user on public.work_room_prefs (user_id);

alter table public.work_room_prefs enable row level security;

-- 본인 행만 읽고 쓴다(남의 개인 설정 열람·변조 차단). 0076 과 같은 형태.
drop policy if exists wrp_select on public.work_room_prefs;
create policy wrp_select on public.work_room_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 쓰기엔 can_see_room 가드를 덧댄다 — 못 보는 방에 쓰레기 행을 만들 이유가 없다.
-- ★USING 에는 걸지 않는다: 나간 방·삭제된 방에 남은 내 행을 지울 수 없게 되기 때문(0127·0148 과 같은 판단).
drop policy if exists wrp_insert on public.work_room_prefs;
create policy wrp_insert on public.work_room_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_see_room(room_id));

drop policy if exists wrp_update on public.work_room_prefs;
create policy wrp_update on public.work_room_prefs
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists wrp_delete on public.work_room_prefs;
create policy wrp_delete on public.work_room_prefs
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.work_room_prefs to authenticated;

comment on table public.work_room_prefs is
  '(사용자 × 방) 개인 설정(0149): 이름·사진·색의 개인 덮어쓰기 + 할일 완료 알림 표시 여부. 행이 없으면 전역 값 + show_task_done=true 가 기본이다.';

-- 실시간: 개인 설정이라 남의 변경을 받을 필요가 없다 → publication 에 넣지 않는다.
