-- 0148_room_open_to_staff.sql — 방 만들기·초대·나가기를 전원에게, 삭제는 사장에게
--
-- ── 배경 ───────────────────────────────────────────────────────────────────
-- 0147 이 "방은 멤버십으로만 보인다"로 바꿨다. 이제 **누가 방을 만들 수 있나**를 연다.
-- 지금까지는 wr_insert 가 auth_can_manage() 라 사장·매니저만 만들 수 있었다. 카톡처럼
-- 매장 사람이면 누구나 만들 수 있어야 직원들끼리 쓰는 방이 생긴다.
--
-- ── 규칙 ───────────────────────────────────────────────────────────────────
--   만들기   : 매장 소속이면 누구나 (created_by 위조 방어는 0127 그대로 승계)
--   이름변경 : 그 방 멤버면 누구나 (전역 이름은 만들 때 한 번 정해지고, 이후 개인 변경은
--              work_room_prefs 로 간다 — 0149. 여기서 여는 것은 "방 자체의 이름"이다)
--   초대     : 그 방 멤버면 누구나, 대상은 같은 매장 사람만
--   나가기   : 누구나 자기 행을 지운다
--   내보내기 : 관리자(사장·매니저)만
--   삭제     : **사장 + 그 방 멤버**일 때만. 나가면 삭제 권한도 사라진다(완전 분리).
--              그리고 실제 DELETE 가 아니라 soft delete 다 — 대화·완료 기록을 보존한다.
--
-- ── ⛔ 절대 열면 안 되는 것 ────────────────────────────────────────────────
-- wrm_insert 의 can_see_room(room_id) 조건. 이걸 빼면 **못 보는 방에 자기를 밀어넣는**
--   우회로가 열린다(0126 이 막은 바로 그것). 초대는 "그 방 안에 있는 사람"만 할 수 있다.

do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then

    -- ── 만들기: 매장 소속이면 누구나 ──────────────────────────────────────
    -- 0127 본문에서 auth_can_manage() 만 뺀다. created_by 검사는 그대로 —
    -- 이게 없으면 남의 uuid 로 방을 만들어 그 사람을 멤버로 밀어넣을 수 있다(0127 C2).
    drop policy if exists wr_insert on public.work_rooms;
    create policy wr_insert on public.work_rooms
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (created_by is null or created_by = (select auth.uid()))
      );

    -- ── 이름 변경: 그 방 멤버면 ───────────────────────────────────────────
    -- can_see_room 유지 = 못 보는 방을 전체방으로 승격하는 경로 차단(0126 의도).
    -- ★deleted_at 을 이 정책으로 건드릴 수 있다는 점에 주의 — 그래서 삭제는 아래 RPC 로만 한다.
    --   (USING 이 옛 행을 보므로 이미 삭제된 방은 can_see_room=false 라 되살릴 수는 없다.)
    drop policy if exists wr_update on public.work_rooms;
    create policy wr_update on public.work_rooms
      for update using      (unit_id = (select public.auth_unit_id()) and public.can_see_room(id))
                with check (unit_id = (select public.auth_unit_id()) and public.can_see_room(id));

    -- ── 실제 DELETE: 남겨두되 앱은 쓰지 않는다 ────────────────────────────
    -- 운영·정리 경로 보존용. 앱의 '채팅방 삭제'는 아래 soft_delete_room() 을 부른다.
    drop policy if exists wr_delete on public.work_rooms;
    create policy wr_delete on public.work_rooms
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_is_owner())
        and not is_default
        and public.is_room_member(id)
      );

    -- ── 멤버 쓰기: for all 하나를 초대/나가기·내보내기로 쪼갠다 ────────────
    -- 전엔 wrm_write 하나가 auth_can_manage() 를 요구해서 **직원이 자기 행도 못 지웠다**
    -- (= 방 나가기 버튼이 눌리는데 아무 일도 안 일어남).
    drop policy if exists wrm_write on public.work_room_members;

    -- 초대: 그 방 멤버가 · 볼 수 있는 방에 · 같은 매장 사람을
    drop policy if exists wrm_insert on public.work_room_members;
    create policy wrm_insert on public.work_room_members
      for insert with check (
        public.room_in_my_unit(room_id)
        and public.can_see_room(room_id)          -- ⛔ 절대 빼지 말 것
        and exists (
          select 1 from public.unit_members m
          where m.unit_id = (select public.auth_unit_id())
            and m.user_id = work_room_members.user_id
        )
      );

    -- 나가기(자기 행) 또는 내보내기(관리자).
    -- ★USING 에 can_see_room 을 걸지 않는다 — 이미 삭제된 방이나 못 보게 된 방에 남은
    --   자기 찌꺼기 행을 정리할 수 없게 되기 때문이다(0127 이 같은 이유로 USING 을 비워뒀다).
    drop policy if exists wrm_delete on public.work_room_members;
    create policy wrm_delete on public.work_room_members
      for delete using (
        public.room_in_my_unit(room_id)
        and (
          user_id = (select auth.uid())
          or ((select public.auth_can_manage()) and public.can_see_room(room_id))
        )
      );
  end if;
end $$;

-- ── 방 삭제 = soft delete (RPC 로만) ───────────────────────────────────────
-- 왜 정책이 아니라 RPC 인가: wr_update 가 **그 방 멤버 전원**에게 열려 있다(이름 변경).
--   deleted_at 도 같은 UPDATE 라 그 문으로 아무나 방을 지울 수 있게 된다.
--   판정을 정책에 더 얹어 쪼개는 것보다, 삭제라는 **행위 하나를 함수로 좁히는** 편이 읽기 쉽다.
-- 규칙: 사장 + 그 방 멤버 + 기본방 아님. 나간 사장은 is_room_member 가 false 라 자동으로 막힌다.
create or replace function public.soft_delete_room(rid text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
begin
  if v_uid is null or v_unit is null then
    return false;
  end if;
  update public.work_rooms r
     set deleted_at = now()
   where r.id = rid
     and r.unit_id = v_unit
     and r.deleted_at is null
     and not r.is_default                              -- 기본방('전체')은 삭제 불가
     and exists (                                      -- 사장만
       select 1 from public.unit_members m
       where m.unit_id = v_unit and m.user_id = v_uid and m.role = 'owner'
     )
     and exists (                                      -- 그리고 그 방 멤버여야
       select 1 from public.work_room_members wm
       where wm.room_id = r.id and wm.user_id = v_uid
     );
  return found;
end $$;

revoke execute on function public.soft_delete_room(text) from public, anon;
grant  execute on function public.soft_delete_room(text) to authenticated;

comment on function public.soft_delete_room(text) is
  '채팅방 삭제(0148): deleted_at 만 찍는다 — 대화·공지·완료기록은 보존되고 UI 에서만 사라진다. 사장이면서 그 방 멤버일 때만. 나간 사장은 막힌다.';

-- 적용 후 게이트:
--   npm run qa:roles
--   수동: 직원 계정으로 방 생성·초대·나가기 / 매니저가 삭제 시도 → 거부 / 사장이 나간 뒤 삭제 시도 → 거부
