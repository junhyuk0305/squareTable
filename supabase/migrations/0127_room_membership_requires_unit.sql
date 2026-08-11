-- 0127_room_membership_requires_unit.sql — "방 멤버"는 반드시 **그 매장 사람**이어야 한다 (2026-08-11)
--
-- 0126 직후 보안 리뷰(/cso)에서 두 경로가 실증됐다. 뿌리는 하나다:
-- **"이 사람이 이 방을 볼 수 있나"를 물으면서 "이 사람이 이 매장 사람인가"를 한 번도 안 물었다.**
--
--  C1. user_can_see_room(rid, uid) 의 `r.is_default` 가지가 매장 소속 검사 없이 단락된다.
--      → 기본방에 대해서는 **아무 uuid 나** true.
--      악용: 사장이 기본방 할일의 owner_id 에 생판 남의 uuid 를 넣고 remind_at 을 건다
--            → due_task_reminders() 가 그를 수신자로 돌려주고(0126 이 이 함수로 거르므로)
--            → 엣지 deliver() 는 수신자의 매장 소속을 검사하지 않는다(push/index.ts:102)
--            → **플랫폼의 임의 사용자에게 공격자가 쓴 본문이 푸시된다.**
--      실증: 무관한 B매장 사장이 out_recipients 에 들어왔고 본문이 그대로 실렸다.
--
--  C2. wr_insert 가 created_by 를 검증하지 않는데 0126 의 트리거가 그 값을 그대로 믿는다.
--      악용: 매니저가 created_by=<외부인 uuid> 로 방을 만들면 그 외부인이 work_room_members 에 들어간다.
--            직접 읽기는 unit_id = auth_unit_id() 가 막지만, user_can_see_room 이 true 가 되어 C1 경로로 이어진다.
--      같은 구멍이 문 하나 더 있다 — wrm_write 도 **대상자**가 그 매장 사람인지 보지 않는다.
--
-- 방침: 판정 함수를 **정답의 자리**로 삼는다(fail-closed). 정책·트리거는 그 판정을 반복하지 않고,
--       "애초에 오염된 행이 안 들어오게" 입구만 좁힌다. 그래서 이미 들어와 있는 찌꺼기 행이 있어도
--       user_can_see_room 이 false 를 내므로 조용히 무력화된다(행 삭제는 하지 않는다 — 되돌릴 수 없다).

-- ── 1) 판정 함수: 그 매장 사람이 아니면 어느 방도 볼 수 없다 ────────────────
-- 0126 본문의 세 가지(기본방·사장·방멤버)를 그대로 두고, **unit_members 조인을 앞에 세워** 전 가지에 공통으로 건다.
-- 정상 대상(직원·매니저·사장)은 전부 그 매장 unit_members 행이 있으므로 의미 변화가 없다.
create or replace function public.user_can_see_room(rid text, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.work_rooms r
    join public.unit_members um
      on um.unit_id = r.unit_id and um.user_id = uid   -- ★그 매장 사람이어야 한다(세 가지 전부에 적용)
    where r.id = rid
      and (
        r.is_default
        or um.role = 'owner'
        or exists (select 1 from public.work_room_members m where m.room_id = r.id and m.user_id = uid)
      )
  )
$$;
grant execute on function public.user_can_see_room(text, uuid) to authenticated;

-- ── 2) 입구 1: 방을 만들 때 created_by 를 위조하지 못한다 ──────────────────
-- 0093 wr_insert 본문 승계 + created_by 조건만 덧댄다.
-- 클라이언트는 늘 자기 id 를 싣는다(useRoomStore.createRoom / hydrate 자가치유) — 정상 경로 무영향.
-- 시드·마이그레이션은 service_role 이라 RLS 를 타지 않는다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists wr_insert on public.work_rooms;
    create policy wr_insert on public.work_rooms
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and (created_by is null or created_by = (select auth.uid()))
      );

    -- 입구 2: 방 멤버로 **넣는 대상**도 그 매장 사람이어야 한다.
    -- WITH CHECK 에만 건다 — USING 에 걸면 이미 나간 사람의 찌꺼기 행을 지울 수 없게 된다(정리 경로 보존).
    drop policy if exists wrm_write on public.work_room_members;
    create policy wrm_write on public.work_room_members
      for all
      using (
        (select public.auth_can_manage())
        and public.room_in_my_unit(room_id)
        and public.can_see_room(room_id)
      )
      with check (
        (select public.auth_can_manage())
        and public.room_in_my_unit(room_id)
        and public.can_see_room(room_id)
        and exists (
          select 1 from public.unit_members m
          where m.unit_id = (select public.auth_unit_id()) and m.user_id = work_room_members.user_id
        )
      );
  end if;
end $$;

-- ── 3) 입구 3: 트리거도 클라 입력을 그대로 믿지 않는다 ────────────────────
-- 0126 본문 승계 + "생성자가 그 매장 사람인가" 한 조건. 위 wr_insert 로 이미 위조가 막히지만,
-- 이 트리거는 SECURITY DEFINER(RLS 우회)라 **자기 입력을 스스로 검증**해야 한다 —
-- service_role 경로(시드·백필)로도 같은 값이 들어올 수 있다.
create or replace function public.wr_add_creator_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_default, false) or new.created_by is null then
    return new;
  end if;
  -- 그 매장 사람이 아니면 넣지 않는다(위조·오래된 시드 방어).
  if not exists (
    select 1 from public.unit_members m
    where m.unit_id = new.unit_id and m.user_id = new.created_by
  ) then
    return new;
  end if;
  -- 사장은 auth_is_owner() 로 이미 전 방을 보므로 멤버 행을 만들지 않는다.
  if exists (
    select 1 from public.unit_members m
    where m.unit_id = new.unit_id and m.user_id = new.created_by and m.role = 'owner'
  ) then
    return new;
  end if;
  insert into public.work_room_members (room_id, user_id)
  values (new.id, new.created_by)
  on conflict (room_id, user_id) do nothing;
  return new;
end $$;

-- 적용 후 게이트:
--   node scripts/tmp-qa-p5-cso.mjs        (전 3 FAIL → 후 0 FAIL)
--   node scripts/tmp-qa-p5-isolation.mjs  (33/33 유지 — 과잉 차단 회귀 확인)
--   node scripts/qa-room-isolation.mjs · npm run qa:task-reminder · qa:task-knowhow · qa:roles
