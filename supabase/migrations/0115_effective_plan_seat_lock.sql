-- 0115_effective_plan_seat_lock.sql — 만료 = 무료 강등 + 좌석 잠금
--
-- ── 배경(2026-08-06 라이브 검증으로 확정된 결함 2건) ──────────────────────────
-- 7일 체험(promo 0092)은 admin_activate_store(unit, 7, 'single')로 plan='single' + paid_until=+7d 를 쓴다.
-- 8일째에 실측한 결과:
--   ① 클라 deriveSubscription 이 entitled=false → **앱이 완전히 잠긴다**(무료 요금제로 안 돌아감).
--      영업으로 붙인 매장이 8일째에 앱을 못 연다.
--   ② 서버 캡 3곳이 unit_subscriptions.plan 컬럼만 읽고 paid_until/status 를 **보지 않는다**.
--      만료 후에도 DB plan 이 'single' 로 남아 있어 AI 1500건·직원 무제한이 계속 나갔다(cap=1500 실측).
--
-- ── 이 마이그레이션의 결정 ──────────────────────────────────────────────────
-- 만료 처리 = **무료 요금제로 강등**(완전 잠금 폐기). 미납 압박은 잠금이 아니라 무료 한도로 건다.
-- 강등되면 직원 좌석이 넘칠 수 있다(체험 중 5명 → 무료 3명) → **늦게 합류한 순서로 잠근다**.
--
-- ★상태를 쓰지 않고 전부 **파생**으로 푼다. 크론으로 plan 컬럼을 되돌리는 방식은 크론이 밀리는
--   동안 그대로 구멍이 되고, 실패하면 조용히 유료 한도가 유지된다. 파생은 시계에 의존하지 않는다.
--
-- ── 계층 ────────────────────────────────────────────────────────────────────
--   effective_plan(unit)   = 과금 판정 SSOT. 캡 3곳이 s.plan 대신 이걸 참조한다.
--   seat_rank / my_seat_locked / unit_seat_status = 좌석 판정 SSOT. 화면은 판정을 복제하지 않는다.
--   ★클라 카운터파트: src/lib/utils/subscription.ts deriveSubscription (만료 → 무료 취급).
--     두 곳이 어긋나면 "서버는 무료인데 화면은 잠김" 같은 split-brain 이 된다.
--
-- ── 적용 후 게이트 ──────────────────────────────────────────────────────────
--   npm run qa:billing-tiers   (캡 3종 회귀 — 이 마이그레이션이 캡 함수 4개를 재정의한다)
--   node scripts/qa-promo-codes.mjs
--   npm run qa:onboarding      (create_store 재정의 — 0065 드리프트 선례)

-- ════════════════════════════════════════════════════════════════════════════
-- (1) effective_plan — 과금 판정 SSOT
-- ════════════════════════════════════════════════════════════════════════════
-- 규칙(클라 deriveSubscription 과 동일):
--   plan 이 single/multi 가 아니면        → 'free'
--   active + (paid_until 없음 | 미래)     → 그 plan (paid_until null = 수동 무기한 부여)
--   trialing + trial_ends_at 미래         → 그 plan (plan!=free 인 이상상태의 안전 fallback)
--   그 외(만료·status 불명)               → 'free'
-- 구독행 자체가 없으면 'free'(신규/레거시 매장 — 기존 coalesce(s.plan,'free') 동작과 같다).
create or replace function public.effective_plan(p_unit text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select case
        when s.plan not in ('single', 'multi') then 'free'
        when s.status = 'active'
             and (s.paid_until is null or s.paid_until > now()) then s.plan
        when s.status = 'trialing'
             and s.trial_ends_at is not null and s.trial_ends_at > now() then s.plan
        else 'free'
      end
      from public.unit_subscriptions s
      where s.unit_id = p_unit
    ),
    'free'
  )
$$;
revoke all on function public.effective_plan(text) from public, anon, authenticated;
grant execute on function public.effective_plan(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 합류 시각 — 좌석 잠금 순서의 기준
-- ════════════════════════════════════════════════════════════════════════════
-- profiles.created_at(계정 생성일)을 순서로 쓰면, 오래된 계정이 새 매장에 늦게 합류했을 때
-- 엉뚱한 직원이 잠긴다. 잠금은 사람을 실제로 막는 판정이라 순서가 틀리면 안 된다.
alter table public.profiles add column if not exists joined_unit_at timestamptz;

-- 기존 재직 직원 백필 — 순서 정보가 없으므로 계정 생성일로 채운다(신규부터는 정확해진다).
update public.profiles p
   set joined_unit_at = p.created_at
 where p.joined_unit_at is null and p.unit_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 좌석 판정 — rank / 내 잠금 여부 / 매장 요약
-- ════════════════════════════════════════════════════════════════════════════
-- 재직 정의는 approve_member 의 좌석 캡과 **같은 기준**을 쓴다(role='junior' & 미탈퇴).
-- 두 곳이 다른 기준을 쓰면 "승인은 막혔는데 잠기지는 않는" 어긋남이 생긴다.
create or replace function public.seat_rank(p_unit text, p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select r.rn from (
    select pr.id,
           row_number() over (order by coalesce(pr.joined_unit_at, pr.created_at) asc, pr.id asc)::int as rn
      from public.profiles pr
     where pr.unit_id = p_unit and pr.role = 'junior' and pr.deleted_at is null
  ) r
  where r.id = p_uid
$$;
revoke all on function public.seat_rank(text, uuid) from public, anon, authenticated;

-- 내 좌석이 잠겼는가 — 직원 앱이 진입 시 확인한다.
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

  select p.unit_id, p.role into v_unit, v_role
    from public.profiles p where p.id = v_uid and p.deleted_at is null;
  if v_unit is null or coalesce(v_role, '') <> 'junior' then return false; end if;

  -- 유료 매장은 좌석 무제한 — 잠금 자체가 없다.
  if public.effective_plan(v_unit) <> 'free' then return false; end if;

  v_rank := public.seat_rank(v_unit, v_uid);
  -- rank 를 못 구하면(경쟁 조건·정의 불일치) 잠그지 않는다 — 과금 로직 버그로 직원을 막지 않는다(fail-open).
  return coalesce(v_rank, 1) > 3;
end $$;
revoke all on function public.my_seat_locked() from public, anon, authenticated;
grant execute on function public.my_seat_locked() to authenticated;

-- 사장 화면용 요약 — "직원 5명 중 2명이 잠겼어요".
create or replace function public.unit_seat_status()
returns table(total int, cap int, locked int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id(); -- 멤버십 검증된 활성 매장 — definer 격리 게이트
  v_free boolean;
begin
  if v_unit is null then
    total := 0; cap := 3; locked := 0; return next; return;
  end if;

  select count(*)::int into total
    from public.profiles pr
   where pr.unit_id = v_unit and pr.role = 'junior' and pr.deleted_at is null;

  v_free := (not public.billing_free_mode()) and public.effective_plan(v_unit) = 'free';
  cap := 3;
  locked := case when v_free then greatest(total - cap, 0) else 0 end;
  return next;
end $$;
revoke all on function public.unit_seat_status() from public, anon, authenticated;
grant execute on function public.unit_seat_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 캡 함수 4개 — s.plan → effective_plan()
-- ════════════════════════════════════════════════════════════════════════════
-- 아래 넷은 각각 0082(AI 2종)·0062(approve_member)·0065(create_store)에서 통째로 가져와
-- **플랜을 읽는 한 줄만** 바꾼 것이다. 나머지 로직은 손대지 않는다(부분 패치로 인한 드리프트 방지).

-- ── 4-1. consume_ai_quota (정본 0082) ───────────────────────────────────────
create or replace function public.consume_ai_quota()
returns table(allowed boolean, used_count int, cap_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id();
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_plan  text;
  v_used  int;
  v_cap   int;
begin
  if v_unit is null then
    allowed := false; used_count := 0; cap_count := 150;
    return next; return;
  end if;

  insert into public.ai_usage_monthly as au (unit_id, month, used, updated_at)
  values (v_unit, v_month, 1, now())
  on conflict (unit_id, month) do update
    set used = au.used + 1, updated_at = now()
  returning au.used into v_used;

  -- ★0115: plan 컬럼이 아니라 유효 플랜(만료 반영). 만료된 single 이 1500 을 계속 받던 구멍.
  v_plan := public.effective_plan(v_unit);

  v_cap := case when v_plan in ('single', 'multi') then 1500 else 150 end;

  if public.billing_free_mode() then
    allowed := true;
  else
    allowed := v_used <= v_cap;
  end if;
  used_count := v_used; cap_count := v_cap;
  return next;
end $$;
grant execute on function public.consume_ai_quota() to authenticated;

-- ── 4-2. ai_quota_status (정본 0082) ────────────────────────────────────────
create or replace function public.ai_quota_status()
returns table(used_count int, cap_count int, exceeded boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id();
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_plan  text;
  v_used  int := 0;
  v_cap   int;
begin
  if v_unit is null then
    used_count := 0; cap_count := 150; exceeded := true;
    return next; return;
  end if;

  select coalesce(au.used, 0) into v_used
    from public.ai_usage_monthly au
   where au.unit_id = v_unit and au.month = v_month;
  v_used := coalesce(v_used, 0);

  v_plan := public.effective_plan(v_unit); -- ★0115
  v_cap := case when v_plan in ('single', 'multi') then 1500 else 150 end;

  used_count := v_used;
  cap_count  := v_cap;
  exceeded   := (not public.billing_free_mode()) and v_used >= v_cap;
  return next;
end $$;
grant execute on function public.ai_quota_status() to authenticated;

-- ── 4-3. approve_member (정본 0062) ─────────────────────────────────────────
-- 변경점 2개: ① 플랜 판정을 effective_plan 으로 ② 승인 시 joined_unit_at 기록(좌석 순서 기준).
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_plan  text;
  v_staff int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지(4번째 승인 차단). FREE_MODE 면 우회.
  -- (한도 3 = tiers.ts PLANS.free.maxStaff 와 동일해야 함)
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
      select count(*) into v_staff
        from public.profiles pr
       where pr.unit_id = v_unit and pr.role = 'junior' and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  update public.profiles
     set unit_id = pending_unit_id, pending_unit_id = null, role = 'junior',
         joined_unit_at = now() -- ★0115: 좌석 잠금 순서의 기준
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;

-- ── 4-4. create_store (정본 0065) ───────────────────────────────────────────
-- 변경점 1개: 매장 수 캡의 플랜 판정을 effective_plan 으로. 나머지 100% 동일(시그니처 포함).
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null,
  p_birth_date date default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_code  text;
  v_biz   text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind   text := nullif(btrim(coalesce(p_industry, '')), '');
  v_owned int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;

  perform public.ensure_birth_date(v_uid, p_birth_date);

  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null)
     and not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'already_in_store';
  end if;

  select count(*) into v_owned from public.unit_members m where m.user_id = v_uid and m.role = 'owner';
  if v_owned >= 15 then raise exception 'store_limit_reached'; end if;

  -- 매장 수 캡: 2번째 매장부터는 다점포(multi) 플랜 전용. FREE_MODE 면 우회.
  -- ★0115: 기존 소유 매장이 전부 **유효** multi 여야 한다(만료된 multi 로 매장을 계속 늘리던 구멍).
  if not public.billing_free_mode() and v_owned >= 1 then
    if exists (
      select 1
        from public.unit_members m
       where m.user_id = v_uid and m.role = 'owner'
         and public.effective_plan(m.unit_id) <> 'multi'
    ) then
      raise exception 'plan_limit_store';
    end if;
  end if;

  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  insert into public.unit_members (user_id, unit_id, role)
  values (v_uid, v_unit, 'owner')
  on conflict (user_id, unit_id) do nothing;

  update public.profiles set
    unit_id        = coalesce(unit_id, v_unit),
    active_unit_id = v_unit,
    role           = 'owner'
  where id = v_uid;

  insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
  select v_unit, 'trialing', now() + interval '3 days'
  where not exists (
    select 1 from public.unit_subscriptions s where s.unit_id = v_unit
  );

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;
grant execute on function public.create_store(text, text, text, date) to authenticated;
