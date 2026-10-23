-- 0336_free_staff_cap_two.sql — 무료 요금제 직원 상한 3명 → 2명 (2026-10-23 사용자 결정)
--
-- 무료 = 사장 1 + 직원 2. 직원이 3명째가 되는 순간부터 유료가 필요하다.
-- 좌석 기준은 그대로다 — junior+manager & 미탈퇴(0117). 매니저도 좌석을 차지한다.
-- 기존 무료 매장도 즉시 2명이 적용된다(사용자 결정 · 실사용 매장 없음).
--
-- ── 숫자 한 곳 ──────────────────────────────────────────────────────────────
--   예전에는 3이 함수 6개에 따로 박혀 있었다. 이제 free_staff_cap() 하나를 읽는다.
--   클라 사본 = src/lib/config/tiers.ts PLANS.free.maxStaff · 바꿀 때 같이 고친다.
--
-- ── 이 파일이 다시 쓰는 함수 (베이스 = 최고 번호 본문 통째 복사 · ★0336 줄만 바꿨다) ──
--   approve_member         베이스 0273
--   seat_locked_for        베이스 0264
--   unit_seat_status       베이스 0264
--   unit_locked_seats      베이스 0191
--   needs_downgrade_choice 베이스 0196
--   choose_kept_seats      베이스 0142
--   시그니처·반환형은 그대로다(옛 앱 iOS 1.0.1(8)·Android vc8 호환).
--   권한은 각 베이스 그대로 다시 적는다. revoke 는 public·anon·authenticated 만 대상이라
--   0317 이 준 seat_locked_for → service_role 권한은 남는다(그래도 같은 줄을 다시 적는다).

-- ════════════════════════════════════════════════════════════════════════════
-- (0) 무료 직원 상한 — 한 곳
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.free_staff_cap()
returns int language sql immutable set search_path = public as $$
  select 2
$$;
revoke all on function public.free_staff_cap() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) approve_member — 베이스 0273
-- ════════════════════════════════════════════════════════════════════════════
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

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 free_staff_cap()명까지(★0336: 3 → 2). FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
      if v_staff >= public.free_staff_cap() then raise exception 'staff_limit'; end if;
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
       -- ★0231: 숨긴 본사 퀴즈는 고르지 않는다. limit 1 이라 여기서 안 빼면 S3 트리거가 그 행을 버려
       --   숨기지 않은 코스가 있어도 신입 첫 퀴즈가 없어진다.
       and c.brand_hidden_at is null
       -- ★0248: 보관 안 된 노하우가 하나라도 담긴 코스만(전부 보관이면 빈 퀴즈가 된다).
       and exists (select 1 from public.course_entries ce
                     join public.playbook_entries pe on pe.id = ce.entry_id
                    where ce.course_id = c.id and pe.archived_at is null)
       -- ★0273(E1): 외부 사람용·만들던 퀴즈는 고르지 않는다(0139 이전 코스는 예전 그대로).
       and coalesce(c.audience, 'staff') = 'staff'
       and (c.start_at is not null
            or exists (select 1 from public.quiz_assignments x where x.course_id = c.id and x.origin = 'manual')
            or c.created_at < timestamptz '2026-08-11 00:00:00+09')
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

  -- ── 0247(Q22): 신청자에게 승인 알림 — 크론(엣지 sweepMemberNotices)이 deliver() 로 보낸다 ──────
  -- ★합류가 본 목적이다(위 두 블록과 같은 태도) — 알림 적재가 실패해도 합류를 되돌리지 않는다.
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select p_uid, v_unit, 'approved', u.store_name, '합류가 승인됐어요',
           format('%s 직원이 됐어요', coalesce(u.store_name, '매장')), '/stores'
      from public.units u where u.id = v_unit;
  exception when others then
    raise warning 'approve notice skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
revoke execute on function public.approve_member(uuid) from public, anon, authenticated;
grant  execute on function public.approve_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) seat_locked_for — 베이스 0264
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.seat_locked_for(p_unit text, p_uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_staff int;
  v_rank  int;
begin
  if p_unit is null or p_uid is null then return false; end if;
  if public.billing_free_mode() then return false; end if;
  -- 유료 매장은 좌석 무제한 — 잠금 자체가 없다.
  if public.effective_plan(p_unit) <> 'free' then return false; end if;

  -- ★C1: 직원이 상한 이하면 넘친 사람이 없다. 명단보다 먼저 본다.
  --   재직 기준 = 0117 좌석 기준(junior+manager & 미탈퇴) · 상한 = free_staff_cap()(★0336).
  select count(*)::int into v_staff
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = p_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
  if v_staff <= public.free_staff_cap() then return false; end if;

  -- 사장이 고른 명단이 있으면 그것이 순위를 이긴다(0142 D4).
  if exists (select 1 from public.unit_kept_seat_uids(p_unit)) then
    return not exists (select 1 from public.unit_kept_seat_uids(p_unit) u where u = p_uid);
  end if;

  v_rank := public.seat_rank(p_unit, p_uid);
  -- rank 를 못 구하면 잠그지 않는다(fail-open).
  return coalesce(v_rank, 1) > public.free_staff_cap();
end $$;
revoke all on function public.seat_locked_for(text, uuid) from public, anon, authenticated;
grant execute on function public.seat_locked_for(text, uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) unit_seat_status — 베이스 0264
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.unit_seat_status()
returns table(total int, cap int, locked int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if v_unit is null then
    total := 0; cap := public.free_staff_cap(); locked := 0; return next; return;
  end if;

  select count(*)::int,
         (count(*) filter (where public.seat_locked_for(v_unit, m.user_id)))::int
    into total, locked
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;

  cap := public.free_staff_cap();
  return next;
end $$;
revoke all on function public.unit_seat_status() from public, anon, authenticated;
grant execute on function public.unit_seat_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) unit_locked_seats — 베이스 0191 (sweep_owner_alerts 의 잠김 수)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.unit_locked_seats(p_unit text)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  v_total int;
begin
  if public.billing_free_mode() then return 0; end if;
  if public.effective_plan(p_unit) <> 'free' then return 0; end if;

  select count(*)::int into v_total
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = p_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;

  if exists (select 1 from public.unit_kept_seat_uids(p_unit)) then
    return v_total - (select count(*)::int from public.unit_kept_seat_uids(p_unit));
  end if;
  return greatest(v_total - public.free_staff_cap(), 0);
end $$;
revoke all on function public.unit_locked_seats(text) from public, anon, authenticated;
grant execute on function public.unit_locked_seats(text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) needs_downgrade_choice — 베이스 0196
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.needs_downgrade_choice()
returns table(need_store boolean, free_units int, need_seats boolean, over_seats int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_staff int := 0;
begin
  need_store := false; free_units := 0; need_seats := false; over_seats := 0;
  if v_uid is null then return next; return; end if;
  -- 전면 무료 모드면 아무것도 강등되지 않으므로 물어볼 것도 없다.
  if public.billing_free_mode() then return next; return; end if;

  -- ── 매장 축 ──────────────────────────────────────────────────────────────
  free_units := public.owner_free_unit_count(v_uid);
  need_store := free_units >= 2 and public.owner_kept_unit_id(v_uid) is null
    -- ★0196: 유료 매장이 하나라도 있으면 무료 매장은 전부 이전 매장이다 — 고를 것이 없다.
    and not exists (
      select 1 from public.unit_members m
       where m.user_id = v_uid and m.role = 'owner' and public.effective_plan(m.unit_id) <> 'free'
    );

  -- ── 좌석 축(활성 매장) ───────────────────────────────────────────────────
  -- 활성 매장을 보는 이유: 매장을 먼저 고르면 choose_kept_store 가 활성을 그 매장으로 옮기므로,
  -- 그 다음 단계에서 이 판정이 자동으로 '남긴 매장'을 향한다(축을 따로 만들지 않는다).
  v_unit := public.auth_unit_id();
  if v_unit is not null
     and public.effective_plan(v_unit) = 'free'
     and exists (
       select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id = v_uid and m.role = 'owner'
     ) then
    -- 재직 기준 = 0117 좌석 기준(junior+manager & 미탈퇴).
    select count(*)::int into v_staff
      from public.unit_members m
      join public.profiles pr on pr.id = m.user_id
     where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
    over_seats := greatest(v_staff - public.free_staff_cap(), 0);
    -- ★"상한 미만이면 다시 묻는다"가 아니라 "**한 명도 안 골랐으면** 묻는다".
    --   상한을 채우지 않아도(1명만 남기기) 그건 유효한 답이다 — 상한을 요구하면 영영 안 끝난다.
    --   my_seat_locked 도 "행이 하나라도 있으면 선택으로 본다"이므로 두 판정이 같은 술어를 쓴다.
    need_seats := v_staff > public.free_staff_cap() and not exists (select 1 from public.unit_kept_seat_uids(v_unit));
  end if;

  return next;
end $$;
revoke all on function public.needs_downgrade_choice() from public, anon, authenticated;
grant execute on function public.needs_downgrade_choice() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) choose_kept_seats — 베이스 0142
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.choose_kept_seats(p_uids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_n    int := coalesce(array_length(p_uids, 1), 0);
  v_ok   int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 클라가 보낸 매장 id 는 받지 않는다 — 활성 매장에서 사장 멤버십을 서버가 확인(0083 패턴).
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = v_uid and m.unit_id = v_unit and m.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  -- 무료 좌석 캡 = free_staff_cap()(★0336) = tiers.ts PLANS.free.maxStaff.
  if v_n > public.free_staff_cap() then raise exception 'too_many_seats'; end if;
  -- 0명은 받지 않는다 — 빈 명단은 "아무도 안 고름"과 구별되지 않아(둘 다 행 0개) 판정이 순위 규칙으로
  -- 되돌아간다. 고르지 않겠다는 뜻이면 화면이 그냥 안 부르면 된다.
  if v_n < 1 then raise exception 'no_seats_chosen'; end if;

  -- 전원이 이 매장 재직자인지 검증(0117 좌석 기준 — junior+manager & 미탈퇴).
  select count(*)::int into v_ok
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = v_unit and m.user_id = any(p_uids)
     and m.role in ('junior', 'manager') and pr.deleted_at is null;
  if v_ok <> (select count(distinct u) from unnest(p_uids) u) then
    raise exception 'not_a_member';
  end if;

  -- 원자적 교체 — 고쳐 담을 때 옛 명단이 섞이지 않는다.
  delete from public.unit_kept_seats where unit_id = v_unit;
  insert into public.unit_kept_seats (unit_id, user_id)
  select v_unit, u from unnest(p_uids) u
  on conflict (unit_id, user_id) do nothing;
end $$;
revoke all on function public.choose_kept_seats(uuid[]) from public, anon, authenticated;
grant execute on function public.choose_kept_seats(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) 상한을 넘는 옛 명단을 비운다
-- ════════════════════════════════════════════════════════════════════════════
-- 3명 시절에 고른 명단(3명)은 남겨 두면 그 3명이 전부 안 잠긴다(명단이 순위를 이긴다).
-- 비우면 needs_downgrade_choice 가 사장에게 다시 묻고, 그 전까지는 합류 순서로 잠근다.
delete from public.unit_kept_seats k
 where k.unit_id in (
   select unit_id from public.unit_kept_seats
    group by unit_id
   having count(*) > public.free_staff_cap()
 );
