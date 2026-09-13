-- 0201_manager_narrow_to_app.sql — 매니저 경계를 **앱에 맞춰 서버를 좁힌다**
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────────────────
-- 0093(2026-07-30)은 매니저에게 급여·합류 승인을 열었다. 그런데 그 일을 하는 화면
-- (`/owner/staff`·`/owner/payroll`)은 앱의 허용목록(lib/utils/roles.ts MANAGER_OWNER_ROUTES)에
-- 없어서 `owner/_layout` 가드가 매니저를 `/junior/home` 으로 되돌린다. 즉 **서버는 허용, 앱은 차단**
-- 이 2026-07-30 이후 계속 어긋나 있었다(2026-09-13 실측 QA 에서 기록).
--
-- 사장 판정(2026-09-14): **앱에서 되는 것이 기준**이다 → 서버를 앱 쪽으로 좁힌다.
-- ⚠️ 이것은 0093 머리 주석의 "매니저 권한 = 급여(07-30 사용자 확정)"를 **뒤집는 변경**이다.
--    되돌리려면 이 파일이 아니라 roles.ts 허용목록을 여는 쪽(반대 방향)으로 간다 — 판정이 두 곳에
--    생기지 않도록 둘 중 하나만 움직인다.
--
-- ── 무엇을 좁히나(세 가지만) ────────────────────────────────────────────────────────────
--   ① wages_write            — 시급 저장          (화면 /owner/staff)
--   ② save_payroll_settings  — 급여 설정 RPC       (화면 /owner/payroll)
--   ③ approve_member / reject_member — 합류 승인·반려 (화면 /owner/staff)
--
-- ⛔ `auth_can_manage()` 자체는 **건드리지 않는다** — 148곳이 이 함수를 쓰고, 근무표·업무 채팅·
--    노하우 발행 등 매니저가 실제로 여는 화면이 전부 여기에 매달려 있다. 함수를 좁히면 매니저가
--    앱에서 쓰는 것까지 같이 죽는다. 좁히는 것은 위 세 표면뿐이다.
--
-- ── 함수 본문 출처(드리프트 방지) ───────────────────────────────────────────────────────
-- approve_member 는 0169 본문을, reject_member 는 0093 본문을 **파일에서 그대로 복사**했고
-- 역할 검사 한 줄(`mm.role in ('owner','manager')` → `mm.role = 'owner'`)만 바꿨다.
-- 좌석 캡(0115·0117)·게스트 이력 승계(0165)·입사 퀴즈 배정(0169)은 한 줄도 안 바뀐다.
-- (0115 가 0093 대신 0062 를 베이스로 삼아 qa:roles 를 11개 깨뜨린 선례가 이 파일의 이유다.)
--
-- ⚠️ 적용 후: qa:roles · qa:onboarding · qa:payroll · qa:multistore green 확인.

-- ── ① 시급 쓰기: 관리 멤버십 → 소유자 ───────────────────────────────────────────────────
-- 읽기(wages_read, 0122)는 그대로 둔다 — 매니저가 근무표·인건비에서 금액을 **보는** 것은 막지 않는다.
drop policy if exists wages_write on public.wages;
create policy wages_write on public.wages
  for all
  using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ── ② 급여 설정 RPC: 관리 멤버십 → 소유자 ───────────────────────────────────────────────
-- 본문은 0093 그대로, 판정 한 줄만 바꾼다. 예외 이름은 'owner_only' 로 바꾼다 —
-- 'manager_only' 는 이제 사실이 아니고, 클라는 이 문자열을 분기에 쓰지 않는다(guardWrite 가 문구만 쓴다).
create or replace function public.save_payroll_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  update public.units set payroll_settings = p_settings where id = v_unit;
end $$;
grant execute on function public.save_payroll_settings(jsonb) to authenticated;

-- ── ③ 합류 승인 — 본문 = 0169 그대로, 역할 검사 한 줄만 ─────────────────────────────────
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_plan   text;
  v_staff  int;
  v_phone  text;
  v_course text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
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
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, v_unit, 'junior')
    on conflict (user_id, unit_id) do nothing;

  -- ── 0165: 게스트 응시 이력 승계 ───────────────────────────────────────────
  -- 이 매장에서 **같은 전화번호로 링크를 풀었던 행**의 주인을 이 직원으로 바꾼다(0165 §③).
  -- ★합류가 본 목적이고 승계는 부가다 — 여기서 무슨 일이 나도 합류를 되돌리지 않는다.
  begin
    select p.phone_norm into v_phone from public.profiles p where p.id = p_uid;
    if coalesce(v_phone, '') <> '' then
      update public.quiz_attempts a
         set staff_id          = p_uid,
             former_guest_name = a.guest_name,
             guest_name        = null,
             guest_phone       = null
       where a.unit_id     = v_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;

  -- ── 0169: 입사 트리거 — 첫 퀴즈 1개를 배정한다 ─────────────────────────────
  -- ★**코스 1개만.** 첫날에 전부 쏟으면 그날 앱을 끈다(원설계 §06 빈도 상한이 지키려는 것과 같은
  --   실패다). 나머지는 사장 발행과 주기가 이어받는다. 값의 SSOT = schedule.ts
  --   JOIN_FIRST_QUIZ_COURSES.
  -- 고르는 순서: 신입용 코스(key/preset='first_day') → position → 만든 순.
  --   담긴 노하우가 하나도 없는 코스는 건너뛴다 — 빈 퀴즈가 도착하면 첫인상이 그걸로 끝난다.
  -- 실제 도착은 여기서 정하지 않는다. scheduled_on = 오늘이고, 근무일·빈도 상한을 통과할 때
  --   크론이 내보낸다(0139) — 합류가 쉬는 날이면 다음 근무일에 간다.
  -- ★합류가 본 목적이다(위 승계 블록과 같은 태도) — 배정이 실패해도 합류를 되돌리지 않는다.
  begin
    select c.id into v_course
      from public.training_courses c
     where c.unit_id = v_unit
       and c.active
       and exists (select 1 from public.course_entries ce where ce.course_id = c.id)
     order by (case when c.key = 'first_day' or c.preset = 'first_day' then 0 else 1 end),
              c.position, c.created_at, c.id
     limit 1;

    if v_course is not null then
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
      values (v_unit, v_course, p_uid, (now() at time zone 'Asia/Seoul')::date, 'join', v_uid)
      on conflict (course_id, user_id, scheduled_on) do nothing;
    end if;
  exception when others then
    raise warning 'join quiz assignment skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;

-- ── ③ 합류 반려 — 본문 = 0093 그대로, 역할 검사 한 줄만 ─────────────────────────────────
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
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  update public.profiles set pending_unit_id = null
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;
grant execute on function public.reject_member(uuid) to authenticated;

-- 적용 후 확인: 매니저 계정으로 ①시급 저장 ②급여 설정 ③합류 승인 셋 다 거부되는지,
--   사장 계정으로는 셋 다 되는지. 근무표·업무 채팅·노하우 발행은 매니저가 **그대로** 되는지(회귀).
