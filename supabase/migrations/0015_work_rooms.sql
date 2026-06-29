-- 업무 채팅방 분리(카톡식 다중방) — 사장이 방 개설 + 직원 초대/관리.
-- "전부 방 단위로": 채팅 메시지뿐 아니라 공지·할일·완료알림(work_feed/work_templates)도 room_id로 격리.
-- 기존 단일 스트림 데이터는 매장별 기본방('전체')으로 자동 이관(backfill).
--
-- 0001/0007 의 auth_unit_id() / auth_is_owner() 헬퍼 재사용.

-- ── 방(work_rooms) ─────────────────────────────────────────
create table if not exists public.work_rooms (
  id          text primary key,
  unit_id     text not null references public.units(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,   -- 매장 기본방('전체') = 모두 자동 참여
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_wr_unit on public.work_rooms(unit_id);

-- ── 방 멤버(work_room_members) ─────────────────────────────
-- 기본방(is_default)은 별도 멤버행 없이 매장 전원이 본다. 비기본방만 멤버를 명시.
create table if not exists public.work_room_members (
  room_id   text not null references public.work_rooms(id) on delete cascade,
  user_id   uuid not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists idx_wrm_user on public.work_room_members(user_id);

-- ── 기존 업무 데이터에 room_id 부여 ────────────────────────
alter table public.work_feed      add column if not exists room_id text;
alter table public.work_templates add column if not exists room_id text;
alter table public.work_done       add column if not exists room_id text;
create index if not exists idx_wf_room on public.work_feed(room_id);
create index if not exists idx_wt_room on public.work_templates(room_id);
create index if not exists idx_wd_room on public.work_done(room_id);

-- ── 방 가시성 헬퍼 ─────────────────────────────────────────
-- 같은 매장 + (기본방 이거나 사장 이거나 멤버) 일 때 그 방을 볼 수 있다.
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

-- ── backfill: 매장별 기본방 생성 + 기존 피드/할일 이관 ─────
insert into public.work_rooms (id, unit_id, name, is_default, created_at)
select 'room_main_' || u.id, u.id, '전체', true, now()
from public.units u
on conflict (id) do nothing;

update public.work_feed      set room_id = 'room_main_' || unit_id where room_id is null;
update public.work_templates set room_id = 'room_main_' || unit_id where room_id is null;
-- 완료마크는 자기 할일의 방을 따른다(템플릿 join). 매칭 안 되는 건 기본방으로.
update public.work_done d set room_id = t.room_id from public.work_templates t
  where d.template_id = t.id and d.room_id is null;
update public.work_done set room_id = 'room_main_' || unit_id where room_id is null;

-- ── RLS ────────────────────────────────────────────────────
alter table public.work_rooms        enable row level security;
alter table public.work_room_members enable row level security;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    -- 방: SELECT = 가시 방만. 생성/수정/삭제 = 사장만(같은 매장).
    drop policy if exists wr_select on public.work_rooms;
    create policy wr_select on public.work_rooms
      for select using (
        unit_id = public.auth_unit_id()
        and (
          is_default
          or public.auth_is_owner()
          or exists (select 1 from public.work_room_members m where m.room_id = id and m.user_id = auth.uid())
        )
      );
    drop policy if exists wr_insert on public.work_rooms;
    create policy wr_insert on public.work_rooms
      for insert with check (unit_id = public.auth_unit_id() and public.auth_is_owner());
    drop policy if exists wr_update on public.work_rooms;
    create policy wr_update on public.work_rooms
      for update using (unit_id = public.auth_unit_id() and public.auth_is_owner())
                with check (unit_id = public.auth_unit_id() and public.auth_is_owner());
    drop policy if exists wr_delete on public.work_rooms;
    create policy wr_delete on public.work_rooms
      for delete using (unit_id = public.auth_unit_id() and public.auth_is_owner() and not is_default);

    -- 멤버: 본인 행은 본인이, 매장 내 모든 멤버는 사장이 조회. 추가/삭제는 사장만.
    drop policy if exists wrm_select on public.work_room_members;
    create policy wrm_select on public.work_room_members
      for select using (
        user_id = auth.uid()
        or exists (select 1 from public.work_rooms r where r.id = room_id and r.unit_id = public.auth_unit_id() and public.auth_is_owner())
      );
    drop policy if exists wrm_write on public.work_room_members;
    create policy wrm_write on public.work_room_members
      for all
      using      (exists (select 1 from public.work_rooms r where r.id = room_id and r.unit_id = public.auth_unit_id() and public.auth_is_owner()))
      with check (exists (select 1 from public.work_rooms r where r.id = room_id and r.unit_id = public.auth_unit_id() and public.auth_is_owner()));

    -- work_feed: 기존(0013) 정책에 방 가시성 추가. 레거시(room_id null)는 통과.
    drop policy if exists wf_select on public.work_feed;
    create policy wf_select on public.work_feed
      for select using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      );
    drop policy if exists wf_insert on public.work_feed;
    create policy wf_insert on public.work_feed
      for insert with check (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
        and (coalesce(data->>'kind', '') <> 'notice' or public.auth_is_owner())
      );
    -- update/delete 도 방 가시성으로 격리(0013은 매장 단위라 안 속한 방의 메시지를 수정·삭제 가능했음).
    drop policy if exists wf_update on public.work_feed;
    create policy wf_update on public.work_feed
      for update using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      )
      with check (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      );
    drop policy if exists wf_delete on public.work_feed;
    create policy wf_delete on public.work_feed
      for delete using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
        and (coalesce(data->>'kind', '') <> 'notice' or public.auth_is_owner())
      );

    -- work_templates: 기존(0013) scope 정책에 방 가시성 추가.
    drop policy if exists wt_select_scope on public.work_templates;
    create policy wt_select_scope on public.work_templates
      for select using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
        and (
          coalesce(scope, 'shared') = 'shared'
          or owner_id = auth.uid()
          or public.auth_is_owner()
        )
      );
    drop policy if exists wt_insert on public.work_templates;
    create policy wt_insert on public.work_templates
      for insert with check (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      );
    -- update/delete 도 방 가시성으로 격리.
    drop policy if exists wt_update on public.work_templates;
    create policy wt_update on public.work_templates
      for update using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      )
      with check (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      );
    drop policy if exists wt_delete on public.work_templates;
    create policy wt_delete on public.work_templates
      for delete using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
      );

    -- work_done: 0004 work_done_rw(매장 단위 for all)를 방 가시성으로 교체(완료마크도 방 단위).
    drop policy if exists work_done_rw on public.work_done;
    create policy work_done_rw on public.work_done
      for all
      using      (unit_id = public.auth_unit_id() and (room_id is null or public.can_see_room(room_id)))
      with check (unit_id = public.auth_unit_id() and (room_id is null or public.can_see_room(room_id)));
  end if;
end $$;

-- ── 실시간 ─────────────────────────────────────────────────
-- (재실행 안전: 이미 publication 멤버면 add 가 에러나므로 존재 여부 확인 후 추가)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='work_rooms'
  ) then
    alter publication supabase_realtime add table public.work_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='work_room_members'
  ) then
    alter publication supabase_realtime add table public.work_room_members;
  end if;
end $$;
