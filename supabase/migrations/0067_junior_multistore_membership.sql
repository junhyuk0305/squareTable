-- 0067_junior_multistore_membership.sql — Phase 0: 직원(junior) 다점포 지원.
--
-- 문제(라이브 크로스테넌트 QA로 발견): 다점포 인프라(my_units·switch_active_unit)는 unit_members
--   테이블을 멤버십 SSOT로 쓰는데, 직원 멤버십은 profiles.unit_id(스칼라)에만 기록되고 unit_members엔
--   안 들어갔다(채우는 곳=create_store[오너]·0055 일회성 백필뿐). approve_member는 unit_members를
--   갱신 안 한다 → 0055 이후 승인된 직원은 unit_members에 없어 my_units가 비고 switch가 not_a_member.
--
-- 이 마이그레이션 = 멤버십 모델 통일(오너·직원 모두 unit_members가 "전환/열람 가능한 매장"의 SSOT):
--   ① approve_member  — 승인 시 unit_members(junior) insert + 주매장 보존 + 좌석캡을 unit_members 기준으로.
--   ② join_by_invite  — already_in_store 완화(다른 매장 추가 합류 허용) + 오너 차단 + 이미 멤버 차단.
--   ③ remove_staff    — ★보안: 이 매장 unit_members 삭제(내보낸 직원이 switch로 재접근 못 함) + 포인터 재지정.
--   ④ leave_store     — ★보안: 활성 매장 unit_members 삭제 + 남은 소속으로 재지정.
--   ⑤ 백필            — 0055 이후 누락된 profiles.unit_id → unit_members (멱등).
--
-- 서버 경계는 그대로: switch_active_unit(0055)는 unit_members 멤버십을 검증하고, active_unit_id는
--   RLS profiles_update로 write-freeze돼 이 definer RPC로만 바뀐다. 클라 가드(role==='owner')는 UX였을 뿐.
-- 게이트: /cso + qa:onboarding + scripts/qa-junior-multistore.mjs(자기매장만 전환·비멤버 거부·내보낸뒤 재접근차단).

-- ── ⑤-a ★보안 정합성 정리: stale junior 멤버십 제거 ─────────────────────────
-- OLD remove_staff/leave_store는 unit_members를 안 지웠다. 0055 백필 이후 내보내진/나간 직원은
-- profiles.unit_id는 null(또는 다른 매장)로 바뀌었지만 unit_members(junior) 행이 남아 있을 수 있다.
-- 이 잔존 행을 두면 Phase 0로 직원 전환이 열리는 순간 '내보낸 직원이 switch로 재접근'하는 구멍이 된다.
-- 단일매장 모델이던 지금까지 직원의 유효 소속 = profiles.unit_id 하나뿐이므로, 그와 불일치하는
-- junior 행은 전부 이탈분(stale) → 삭제. (오너 행 role='owner'은 다점포 소유라 건드리지 않는다.)
delete from public.unit_members m
 where m.role = 'junior'
   and not exists (
     select 1 from public.profiles p
      where p.id = m.user_id and p.unit_id = m.unit_id
   );

-- ── ⑤-b 백필: unit_members 누락분(0055 이후 승인된 직원 등) ──────────────────
insert into public.unit_members (user_id, unit_id, role)
select p.id, p.unit_id, coalesce(p.role, 'junior')
  from public.profiles p
 where p.unit_id is not null
on conflict (user_id, unit_id) do nothing;

-- ── ① approve_member (정본 재확정 = 이 파일, 0062 대체) ──────────────────────
-- 변경점(0062 대비): (a) 소속 확정 시 unit_members(junior) insert. (b) 주매장(unit_id)은 첫 매장만
--   보존(coalesce), 활성(active_unit_id)은 첫 매장일 때만 세팅(추가 승인은 현재 활성 유지). (c) 좌석캡
--   재직수를 profiles.unit_id 대신 unit_members(junior) 기준으로 — 주매장이 다른 알바도 정확히 카운트.
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_plan  text;
  v_staff int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior) 수(주매장이 다른 알바도 포함) & 미탈퇴(deleted_at null).
  if not public.billing_free_mode() then
    select s.plan into v_plan from public.unit_subscriptions s where s.unit_id = v_unit;
    if coalesce(v_plan, 'free') = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role = 'junior' and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  -- 신청(pending) 검증 + 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 승인은 현재 활성 유지).
  update public.profiles
     set unit_id         = coalesce(unit_id, v_unit),
         active_unit_id  = coalesce(active_unit_id, v_unit),
         pending_unit_id = null,
         role            = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, v_unit, 'junior')
    on conflict (user_id, unit_id) do nothing;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;

-- ── ② join_by_invite (정본 재확정 = 이 파일, 0065 대체) ──────────────────────
-- 변경점(0065 대비): already_in_store(unit_id 존재=차단)를 걷어내 직원이 다른 매장에 추가 합류할 수
--   있게 한다. 대신 (a) 오너는 합류 불가(자기 매장 관리 — 남의 매장 junior로 강등 방지), (b) 이미 그
--   매장의 멤버면 차단(중복). 나머지(생년월일 강제·10분5회 잠금·초대만료·즉시합류금지)는 0065와 동일.
create or replace function public.join_by_invite(p_code text, p_birth_date date default null)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_name   text;
  v_recent int;
  v_role   text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- 최근 10분 실패 5회 이상 잠금(무차별 대입 차단).
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.uid = v_uid and ja.ok = false and ja.attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'too_many_attempts'; end if;

  -- 오너는 초대 합류 불가(남의 매장 junior로 강등 방지).
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role = 'owner' then raise exception 'owner_cannot_join'; end if;

  -- 신청중이면 중복 신청 차단(한 번에 하나). 다점포: 이미 소속이어도 '다른 매장' 신청은 허용(already_in_store 제거).
  if exists (select 1 from public.profiles p where p.id = v_uid and p.pending_unit_id is not null) then
    raise exception 'already_pending';
  end if;

  select u.id, u.store_name into v_unit, v_name
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- 0행 = invalid_code 신호(실패비용 누적 → 잠금).
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    return;
  end if;

  -- 이미 이 매장의 멤버면 차단(다점포: 다른 매장은 위에서 통과).
  if exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = v_unit) then
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    raise exception 'already_member';
  end if;

  -- ⚠️ 즉시 합류 금지 — 신청만. unit_id/unit_members는 사장 승인(approve_member) 때 붙는다.
  update public.profiles set pending_unit_id = v_unit where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;
grant execute on function public.join_by_invite(text, date) to authenticated;

-- ── ③ remove_staff (정본 재확정 = 이 파일, 0026 대체) ───────────────────────
-- 변경점(0026 대비): 대상 판정을 profiles.unit_id → unit_members(이 매장 junior 멤버십) 기준으로,
--   그리고 ★내보내는 순간 unit_members 행을 삭제한다(안 하면 내보낸 직원이 switch_active_unit으로
--   재접근 가능 = 보안 구멍). 제거된 매장이 주매장/활성이면 남은 소속으로 포인터 재지정.
create or replace function public.remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_name  text;
  v_last4 text;
  v_next  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if p_staff_id = v_uid then raise exception 'cannot_remove_self'; end if;

  -- 다점포: 이 매장 직원 멤버십은 unit_members 기준(주매장이 다른 알바도 포함).
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = p_staff_id and m.unit_id = v_unit and m.role = 'junior'
  ) then raise exception 'staff_not_found'; end if;

  select p.name, p.phone_last4 into v_name, v_last4 from public.profiles p where p.id = p_staff_id;

  -- 퇴사자 스냅샷 보관(재내보내기 시 최신값 갱신).
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (v_unit, p_staff_id, v_name, v_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- ★ 보안: 이 매장 멤버십 제거 → 내보낸 직원이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = p_staff_id and unit_id = v_unit and role = 'junior';

  -- 포인터 재지정: 제거된 매장이 주매장/활성이면 남은 소속으로(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = p_staff_id and m.role = 'junior'
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = case when active_unit_id = v_unit then v_next else active_unit_id end
   where id = p_staff_id;
end $$;
grant execute on function public.remove_staff(uuid) to authenticated;

-- ── ④ leave_store (정본 재확정 = 이 파일, 0005 대체) ────────────────────────
-- 변경점(0005 대비): 무조건 unit_id=null → 활성 매장의 unit_members 삭제(★보안) + 남은 소속으로 재지정.
create or replace function public.leave_store()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();  -- 나가는 대상 = 현재 활성 매장
  v_next text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.auth_is_owner() then raise exception 'owner_cannot_leave'; end if;
  if v_unit is null then return; end if;

  -- ★ 보안: 활성 매장 멤버십 제거 → 나간 직원이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = v_uid and unit_id = v_unit and role = 'junior';

  -- 남은 소속으로 재지정(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = v_uid and m.role = 'junior'
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = v_next
   where id = v_uid;
end $$;
grant execute on function public.leave_store() to authenticated;
