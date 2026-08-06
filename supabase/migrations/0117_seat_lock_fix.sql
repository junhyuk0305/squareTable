-- 0117_seat_lock_fix.sql — 0115 의 approve_member 리그레션 수정 + 좌석 기준 통일
--
-- ── 무엇이 잘못됐나 ─────────────────────────────────────────────────────────
-- 0115 는 approve_member 를 **0062 본문**에서 가져와 재정의했다. 하지만 정본은 **0093**이었다
--   (0062 → 0067 직원 멤버십 → 0093 매니저 승인권 순으로 두 번 더 갱신돼 있었다).
-- 결과로 0115 가 두 가지를 되돌렸다:
--   ① unit_members 에 직원 멤버십을 기록하는 문장(0067) — 다점포 my_units/switch_active_unit 의 SSOT
--   ② 승인권을 owner/manager 로 완화한 게이트(0093) + 주매장·활성매장 보존 로직
-- qa:roles 가 19 passed / 11 failed 로 잡아냈다(★사장: M 매니저 지정 staff_not_found 가 첫 도미노).
--
-- ── 좌석 기준도 함께 통일한다 ───────────────────────────────────────────────
-- 0093 의 좌석 정의 = **unit_members(junior+manager) & 미탈퇴** — 매니저도 좌석을 차지한다.
-- 0115 의 seat_rank/unit_seat_status 는 profiles(role='junior') 로 세고 있어 기준이 어긋났다.
--   → "승인은 막혔는데 잠기지는 않는" 어긋남이 생긴다. 여기서 approve_member 와 같은 기준으로 맞춘다.
--
-- 합류 순서 기준도 바꾼다: profiles.joined_unit_at(0115 신설) → **unit_members.created_at**.
--   후자가 이미 있고 **매장별**이라 정확하다(직원 다매장, 0067). 0115 가 추가한 컬럼은 쓰이지 않게
--   되므로 함께 제거한다(내가 만든 것만 치운다).
--
-- ── 적용 후 게이트 ──────────────────────────────────────────────────────────
--   npm run qa:roles (0093 회귀 — 이 파일이 approve_member 를 되돌린다)
--   npm run qa:onboarding · npm run qa:billing-tiers · npm run qa:multistore

-- ════════════════════════════════════════════════════════════════════════════
-- (1) approve_member — 정본 0093 본문 복원 + 유효 플랜만 교체
-- ════════════════════════════════════════════════════════════════════════════
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
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role in ('owner', 'manager')
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
end $$;
grant execute on function public.approve_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 좌석 판정 — approve_member 와 같은 기준(unit_members junior+manager)
-- ════════════════════════════════════════════════════════════════════════════
-- 순서 기준 = unit_members.created_at(매장별 합류 시각). 늦게 합류한 사람부터 잠긴다.
create or replace function public.seat_rank(p_unit text, p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select r.rn from (
    select m.user_id,
           row_number() over (order by m.created_at asc, m.user_id asc)::int as rn
      from public.unit_members m
      join public.profiles pr on pr.id = m.user_id
     where m.unit_id = p_unit and m.role in ('junior', 'manager') and pr.deleted_at is null
  ) r
  where r.user_id = p_uid
$$;
revoke all on function public.seat_rank(text, uuid) from public, anon, authenticated;

-- 내 좌석이 잠겼는가 — 활성 매장 기준(직원도 다매장이라 profiles.unit_id 로는 부족하다, 0067).
create or replace function public.my_seat_locked()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_role text;
  v_rank int;
begin
  if v_uid is null then return false; end if;
  if public.billing_free_mode() then return false; end if;

  v_unit := public.auth_unit_id(); -- 멤버십 검증된 활성 매장
  if v_unit is null then return false; end if;

  select m.role into v_role
    from public.unit_members m
   where m.unit_id = v_unit and m.user_id = v_uid;
  -- 사장은 좌석을 차지하지 않는다(잠금 대상 아님).
  if coalesce(v_role, '') not in ('junior', 'manager') then return false; end if;

  -- 유료 매장은 좌석 무제한 — 잠금 자체가 없다.
  if public.effective_plan(v_unit) <> 'free' then return false; end if;

  v_rank := public.seat_rank(v_unit, v_uid);
  -- rank 를 못 구하면 잠그지 않는다 — 과금 로직 버그로 직원을 막지 않는다(fail-open).
  return coalesce(v_rank, 1) > 3;
end $$;
revoke all on function public.my_seat_locked() from public, anon, authenticated;
grant execute on function public.my_seat_locked() to authenticated;

-- 사장 화면용 요약 — "직원 5명 중 2명이 잠겼어요".
create or replace function public.unit_seat_status()
returns table(total int, cap int, locked int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  v_free boolean;
begin
  if v_unit is null then
    total := 0; cap := 3; locked := 0; return next; return;
  end if;

  select count(*)::int into total
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;

  v_free := (not public.billing_free_mode()) and public.effective_plan(v_unit) = 'free';
  cap := 3;
  locked := case when v_free then greatest(total - cap, 0) else 0 end;
  return next;
end $$;
revoke all on function public.unit_seat_status() from public, anon, authenticated;
grant execute on function public.unit_seat_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 0115 가 추가한 미사용 컬럼 제거
-- ════════════════════════════════════════════════════════════════════════════
-- unit_members.created_at 이 이미 매장별 합류 시각을 갖고 있어 쓰이지 않는다.
alter table public.profiles drop column if exists joined_unit_at;
