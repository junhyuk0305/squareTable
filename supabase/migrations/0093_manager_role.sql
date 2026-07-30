-- 0093_manager_role.sql — 매니저(중간 관리자) 역할 도입
--
-- ── 설계 (기획/권한체계_매니저역할_2026-07-30.md · 개발계획 같은 날짜) ─────────────
-- 3단계 고정: 사장(owner) / 매니저(manager) / 직원(junior). 매니저 = 직원 계정의 "매장별" 승격.
--   · profiles.role 은 안 건드린다 — 전역 불변식("계정=owner 아니면 junior", 0055/0067) 유지.
--     매장별 역할 정본 = unit_members.role. 한 사람이 A매장 매니저 + B매장 직원 가능.
--   · auth_is_owner() 재정의 금지(수십 개 정책에 박혀 폭발 반경 큼). 신설 auth_can_manage() =
--     auth_is_owner() OR 활성매장 manager 멤버십 — 순수 가산이라 기존 오너 동작 회귀 0.
--   · Deny-by-default: 여기서 교체하지 않은 정책·RPC 는 자동으로 사장 전용 유지.
--     사장 전용으로 남는 것 = 결제(payment_claims·promo)·매장 존재(create/delete/rename·업종·units_write)
--     ·사람의 지위(set_member_role·remove_staff)·데이터 파기(0027)·허브 통합뷰(owner_overview).
-- 매니저 권한(허용) = 급여(wages·attendance 보정·payroll_settings, 07-30 사용자 확정)
--   ·노하우 발행/승인(playbook_entries·suggestions)·업무/공지(work_*)·근무표(schedule)·합류 승인.
--
-- ⚠️ 게이트: 적용 후 qa:roles(신설)+qa:onboarding+qa:multistore green 필수. 정책 교체는 전부
--    0019/0064 최종 본문 승계(auth_is_owner→auth_can_manage 치환 외 1mm 무변경).

-- ════════════════════════════════════════════════════════════════════════
-- 1) 역할 값 확정 — unit_members.role CHECK (owner/manager/junior)
-- ════════════════════════════════════════════════════════════════════════
-- 값 출처는 create_store('owner')·approve_member('junior')·set_member_role(아래) 뿐이라 기존 행은
-- 전부 owner/junior — CHECK 추가는 안전(위반 행이 있으면 push 가 명시적으로 실패한다. 무음 금지).
alter table public.unit_members drop constraint if exists unit_members_role_check;
alter table public.unit_members
  add constraint unit_members_role_check check (role in ('owner', 'manager', 'junior'));

-- ════════════════════════════════════════════════════════════════════════
-- 2) 판정 함수 — auth_can_manage() (활성 매장에서 관리 권한이 있는가)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.auth_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_is_owner()
      or exists (
        select 1 from public.unit_members m
         where m.user_id = auth.uid()
           and m.unit_id = public.auth_unit_id()
           and m.role = 'manager'
      )
$$;
grant execute on function public.auth_can_manage() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 3) RLS 정책 교체 — 매니저 도메인만 auth_is_owner() → auth_can_manage()
--    (본문 출처: 0019 / 0064 최종본. (select …) 래핑 패턴 유지.)
-- ════════════════════════════════════════════════════════════════════════

-- ── 노하우: 초안 열람(0064) + 발행/수정(0019) ─────────────────────────────
drop policy if exists playbook_entries_read on public.playbook_entries;
create policy playbook_entries_read on public.playbook_entries
  for select using (
    unit_id = (select public.auth_unit_id())
    and (status = 'published' or (select public.auth_can_manage()))
  );
drop policy if exists playbook_entries_write on public.playbook_entries;
create policy playbook_entries_write on public.playbook_entries
  for all
  using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- ── 노하우 제안: 전체 열람·승인/반려·삭제(0019) ──────────────────────────
drop policy if exists ps_select on public.playbook_suggestions;
create policy ps_select on public.playbook_suggestions
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or proposer_id = (select auth.uid()))
  );
drop policy if exists ps_update on public.playbook_suggestions;
create policy ps_update on public.playbook_suggestions
  for update using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
            with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));
drop policy if exists ps_delete on public.playbook_suggestions;
create policy ps_delete on public.playbook_suggestions
  for delete using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or proposer_id = (select auth.uid()))
  );

-- ── 업무: 생성자 없는 레거시 private 할일 열람(0017/0019) ─────────────────
drop policy if exists wt_select_scope on public.work_templates;
create policy wt_select_scope on public.work_templates
  for select using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (
      coalesce(scope, 'shared') = 'shared'
      or owner_id = (select auth.uid())
      or created_by = (select auth.uid())
      or (created_by is null and (select public.auth_can_manage()))
    )
  );

-- ── 피드: 공지 작성/삭제 게이트(0019) ────────────────────────────────────
drop policy if exists wf_insert on public.work_feed;
create policy wf_insert on public.work_feed
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (coalesce(data->>'kind', '') <> 'notice' or (select public.auth_can_manage()))
  );
drop policy if exists wf_delete on public.work_feed;
create policy wf_delete on public.work_feed
  for delete using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (coalesce(data->>'kind', '') <> 'notice' or (select public.auth_can_manage()))
  );

-- ── 출퇴근: 매장 전체 보정(0019) — 급여 포함 확정에 따름 ──────────────────
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update
  using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );

-- ── 시급: 쓰기(0019) — 급여 포함 확정에 따름 ──────────────────────────────
drop policy if exists wages_write on public.wages;
create policy wages_write on public.wages
  for all
  using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- ── 업무방: 방 관리·멤버 관리(0018/0019) ─────────────────────────────────
drop policy if exists wr_select on public.work_rooms;
create policy wr_select on public.work_rooms
  for select using (
    unit_id = (select public.auth_unit_id())
    and (is_default or (select public.auth_can_manage()) or public.is_room_member(id))
  );
drop policy if exists wr_insert on public.work_rooms;
create policy wr_insert on public.work_rooms
  for insert with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));
drop policy if exists wr_update on public.work_rooms;
create policy wr_update on public.work_rooms
  for update using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
            with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));
drop policy if exists wr_delete on public.work_rooms;
create policy wr_delete on public.work_rooms
  for delete using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and not is_default);

drop policy if exists wrm_select on public.work_room_members;
create policy wrm_select on public.work_room_members
  for select using (
    user_id = (select auth.uid())
    or ((select public.auth_can_manage()) and public.room_in_my_unit(room_id))
  );
drop policy if exists wrm_write on public.work_room_members;
create policy wrm_write on public.work_room_members
  for all
  using      ((select public.auth_can_manage()) and public.room_in_my_unit(room_id))
  with check ((select public.auth_can_manage()) and public.room_in_my_unit(room_id));

-- ── 근무표: 설정·시프트·교대 승인(0016/0019) ──────────────────────────────
drop policy if exists sc_write on public.schedule_config;
create policy sc_write on public.schedule_config
  for all using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
          with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

drop policy if exists st_write on public.shift_templates;
create policy st_write on public.shift_templates
  for all using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
          with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

drop policy if exists swap_update on public.swap_requests;
create policy swap_update on public.swap_requests
  for update
  using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or requester_id = (select auth.uid())::text or accepted_by is null)
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or status in ('open','accepted','cancelled'))
  );

-- ── 퇴사자 스냅샷: 열람(0026) — 급여 정리 맥락이라 매니저 포함 ─────────────
drop policy if exists former_staff_select on public.former_staff;
create policy former_staff_select on public.former_staff
  for select using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- ── 멤버 역할 열람: 같은 매장 멤버의 역할(매니저 배지·임명 UI용) ──────────
-- 기존 um_select_self(0055, 본인 행만)에 가산. 역할은 실명 원칙(D2)상 비밀이 아니고,
-- 노출 범위 = 명부(fetchStaffProfiles)·0077 'member' 원천과 동일한 "같은 매장" 축.
drop policy if exists um_select_same_unit on public.unit_members;
create policy um_select_same_unit on public.unit_members
  for select using (unit_id = (select public.auth_unit_id()));

-- ════════════════════════════════════════════════════════════════════════
-- 4) 임명·해제 RPC — set_member_role (★사장 전용: 매니저는 매니저를 못 만든다)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.set_member_role(p_uid uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('manager', 'junior') then raise exception 'invalid_role'; end if;
  if v_unit is null then raise exception 'not_owner'; end if;
  -- ★유일 방어선(definer=RLS 우회): 활성 매장의 소유자 본인만. 매니저·직원·타사장 차단.
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if p_uid = v_uid then raise exception 'cannot_change_self'; end if;

  -- 대상 = 이 매장의 직원/매니저 멤버만(오너 행은 불변 — owner 강등·승격 경로 없음).
  update public.unit_members m
     set role = p_role
   where m.user_id = p_uid and m.unit_id = v_unit and m.role in ('junior', 'manager');
  if not found then raise exception 'staff_not_found'; end if;
end $$;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 5) 급여 설정 RPC — save_payroll_settings (units_write 는 사장 전용 유지)
-- ════════════════════════════════════════════════════════════════════════
-- units.payroll_settings(0054)는 units 행에 얹혀 있어 직접 update 를 열면 매장 이름·biz_no 까지
-- 열린다 → 이 RPC 가 payroll_settings 한 컬럼만 갱신한다. 클라(db.ts savePayrollSettings)는 RPC 로 교체.
create or replace function public.save_payroll_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  if not public.auth_can_manage() then raise exception 'manager_only'; end if;
  update public.units set payroll_settings = p_settings where id = v_unit;
end $$;
grant execute on function public.save_payroll_settings(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 6) 합류 승인/반려 — 승인권을 "소유자"에서 "관리 멤버십(owner/manager)"으로
--    (정본 재확정: approve_member = 이 파일, 0067 대체 / reject_member = 이 파일, 0056 대체)
-- ════════════════════════════════════════════════════════════════════════
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
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화. 그 외 로직은 0067 동일.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role in ('owner', 'manager')
  ) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    select s.plan into v_plan from public.unit_subscriptions s where s.unit_id = v_unit;
    if coalesce(v_plan, 'free') = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
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

create or replace function public.reject_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 승인과 동일하게 관리 멤버십 기준. 그 외 로직은 0056 동일.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role in ('owner', 'manager')
  ) then
    raise exception 'not_owner';
  end if;

  update public.profiles set pending_unit_id = null
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;
grant execute on function public.reject_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 7) 내보내기/나가기 — ★보안: 매니저 멤버십도 제거 대상에 포함
--    (정본 재확정 = 이 파일, 0067 대체. role='junior' 필터에 매니저가 안 걸리면
--     내보낸/나간 매니저의 unit_members 행이 잔존 → switch 로 재접근하는 구멍.)
-- ════════════════════════════════════════════════════════════════════════
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

  -- 다점포: 이 매장 직원(매니저 포함) 멤버십은 unit_members 기준.
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = p_staff_id and m.unit_id = v_unit and m.role in ('junior', 'manager')
  ) then raise exception 'staff_not_found'; end if;

  select p.name, p.phone_last4 into v_name, v_last4 from public.profiles p where p.id = p_staff_id;

  -- 퇴사자 스냅샷 보관(재내보내기 시 최신값 갱신).
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (v_unit, p_staff_id, v_name, v_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- ★ 보안: 이 매장 멤버십 제거(매니저 포함) → 내보낸 사람이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = p_staff_id and unit_id = v_unit and role in ('junior', 'manager');

  -- 포인터 재지정: 제거된 매장이 주매장/활성이면 남은 소속으로(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = p_staff_id and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = case when active_unit_id = v_unit then v_next else active_unit_id end
   where id = p_staff_id;
end $$;
grant execute on function public.remove_staff(uuid) to authenticated;

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

  -- ★ 보안: 활성 매장 멤버십 제거(매니저 포함) → 나간 사람이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = v_uid and unit_id = v_unit and role in ('junior', 'manager');

  -- 남은 소속으로 재지정(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = v_uid and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = v_next
   where id = v_uid;
end $$;
grant execute on function public.leave_store() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 8) 통합 알림 원천(0077) — 사장 전용 원천을 "관리 멤버십" 기준으로
--    (정본 재확정 = 이 파일, 0077 대체. 매니저는 자기 매장의 질문·제안·합류신청 알림을 받는다.
--     변경 = my.role 비교 4곳뿐, 나머지 본문 0077 동일.)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as ( -- 내가 멤버인 매장 + 그 매장에서의 역할(관리 전용 원천 게이트)
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  -- 피드: 공지 전부(읽음 이력 포함) + 나를 @멘션한 글. 방 격리(0015 의미) 준수.
  select f.unit_id, 'feed'::text, f.data
  from (
    select wf.unit_id, wf.data,
           row_number() over (partition by wf.unit_id order by wf.created_at desc) as rn
    from public.work_feed wf
    join my on my.unit_id = wf.unit_id
    cross join me cross join kst
    where wf.feed_date >= kst.since
      and (wf.data->>'kind' = 'notice' or wf.data->'mentions' ? me.uid::text)
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id
          and (r.is_default or my.role in ('owner', 'manager')
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  -- 교대: 열림/수락(승인대기)/확정/반려 — 클라 술어(isIncomingSwap 등)의 입력 상위집합.
  select s.unit_id, 'swap'::text, s.payload
  from (
    select sr.unit_id, to_jsonb(sr) as payload,
           row_number() over (partition by sr.unit_id order by sr.created_at desc) as rn
    from public.swap_requests sr
    join my on my.unit_id = sr.unit_id
    where sr.status in ('open', 'accepted', 'approved', 'rejected')
      and sr.created_at >= now() - interval '30 days'
  ) s where s.rn <= 50

  union all
  -- 배정: 남이 나에게 배정한 할일(오늘 발생 여부·완료 판정은 클라 occursOn/done).
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where wt.owner_id = me.uid
      and wt.created_by is not null and wt.created_by <> me.uid
  ) t where t.rn <= 50

  union all
  -- 완료마크: 오늘(KST) 것만 — 배정 미완료 판정(isPendingAssignment) 입력.
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and wt.owner_id = me.uid)

  union all
  -- 멤버 이름: nameOf(배정자·교대 요청자 표기)용. 소속 매장 명부는 스토어(useStaffStore)와 동일 노출 범위.
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- 관리 전용: 답변 대기 질문(0060 owner_overview pending_q 와 동일 상태 리터럴).
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id and my.role in ('owner', 'manager')
    where uq.status = 'pending_owner_answer'
  ) q where q.rn <= 50

  union all
  -- 관리 전용: 검토 대기 제안.
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id and my.role in ('owner', 'manager')
    where ps.status = 'pending'
  ) g where g.rn <= 50

  union all
  -- 관리 전용: 합류 승인 대기(profiles.pending_unit_id = 내 관리 매장).
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null
$$;
grant execute on function public.my_units_notif_data() to authenticated;

-- 끝. 적용 후: qa:roles → qa:onboarding·qa:multistore 회귀 → 엣지 push 재배포(audience 확장) → 웹 재배포.
