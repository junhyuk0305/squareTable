-- 0092_promo_codes.sql — 무료 이용 코드(프로모션 코드) 발급·사용
--
-- ── 배경 ────────────────────────────────────────────────────────────────────────
-- "7일 무료 코드" 같은 캠페인 수단이 없다. 지금 무료 기간을 주려면 운영자가 매장 id 를 받아
--   admin_activate_store 를 수동 실행해야 해서(입금 파이프라인 재활용) 배포형 캠페인이 불가능하다.
-- 이 마이그레이션은 Stripe Promotion Codes 모델의 최소 번역이다: 코드 정의(promo_codes) +
--   사용 기록(promo_redemptions) + 셀프서비스 리딤 RPC(redeem_promo_code) 셋뿐.
-- ★활성화 경로는 여전히 admin_activate_store 하나다(0083 §② SSOT) — 리딤 RPC 는 검증·기록 후
--   그 함수를 호출할 뿐, 구독 판정/기간 계산 로직을 복제하지 않는다.
--
-- ── 운영 조절 수단(전부 코드 행의 필드) ─────────────────────────────────────────
--   기간      → days (7일·30일…)          선착순 캡 → max_redemptions (null=무제한)
--   코드 만료 → expires_at (null=무기한)   즉시 중단 → active=false
--
-- ── 정책 결정(2026-07-30) ───────────────────────────────────────────────────────
--   무료 매장 전용: 유료 이용이 살아 있는 매장(plan single/multi + 미만료)은 거부(already_paid).
--     만료된 유료 매장은 허용 — 윈백 코드 용도. 같은 코드는 매장당 1회(unique).
--
-- ── 격리/보안(db-rls 규칙) ──────────────────────────────────────────────────────
--   두 테이블 모두 RLS on + 정책 0 + 클라 grant 0 = authenticated/anon 전부 deny.
--     코드 존재 여부 탐색(브루트포스 열람)도 막힌다 — 클라는 RPC 결과로만 성패를 안다.
--   관리(발급·중단)는 admin-console 의 service_role 로만. 리딤은 RPC 한 곳으로만.
--   경쟁 조건: 코드 행 select ... for update 로 잠근 뒤 검사·카운트 증가 — 캡 초과 이중 리딤 없음.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 코드 정의
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.promo_codes (
  -- 대문자 영숫자·하이픈 4~24자. 입력 정규화(upper/trim)는 RPC·콘솔 양쪽에서 하고,
  -- 이 check 는 소문자 코드가 저장돼 "입력은 맞는데 못 찾는" 드리프트를 원천 차단한다.
  code            text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{3,23}$'),
  plan            text not null check (plan in ('single', 'multi')),
  days            int  not null check (days between 1 and 365),
  max_redemptions int  check (max_redemptions is null or max_redemptions >= 1),
  redeemed_count  int  not null default 0,
  expires_at      timestamptz,
  active          boolean not null default true,
  -- 내부 메모("인스타 8월 캠페인" 등) — 사장에게 노출되지 않는다.
  note            text check (note is null or char_length(note) <= 200),
  created_by      text check (created_by is null or char_length(created_by) <= 120),
  created_at      timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
-- 정책·grant 없음 = 클라 전부 deny. service_role(콘솔)과 definer RPC 만 접근.

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 사용 기록 — 매장당 같은 코드 1회의 최종 방어선(unique)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null references public.promo_codes (code) on delete cascade,
  unit_id     text not null references public.units (id) on delete cascade,
  redeemed_by uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code, unit_id)
);
alter table public.promo_redemptions enable row level security;
-- 정책·grant 없음(위와 동일). 사장 화면은 리딤 결과를 구독 상태(unit_subscriptions)로 확인한다.

-- 콘솔 "이 코드 누가 썼나" 조회용.
create index if not exists promo_redemptions_code_at_idx
  on public.promo_redemptions (code, redeemed_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 리딤 RPC — 사장만, 활성 매장 기준, 검증 전부 서버
-- ════════════════════════════════════════════════════════════════════════════
-- named 에러(클라 문구 분기용): code_required · not_owner · code_not_found · code_inactive ·
--   code_expired · code_exhausted · already_paid · already_redeemed
create or replace function public.redeem_promo_code(p_code text)
returns table(unit_id text, status text, paid_until timestamptz, plan text, days int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_code public.promo_codes;
  v_sub  public.unit_subscriptions;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_norm = '' then raise exception 'code_required'; end if;

  -- 클라가 보낸 unit_id 는 받지 않는다 — 활성 매장에서 사장 멤버십을 서버가 확인(0083 패턴).
  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  -- 코드 행 잠금 — 동시 리딤이 캡(max_redemptions)을 넘지 못하게 검사~카운트 증가를 직렬화.
  select * into v_code from public.promo_codes c where c.code = v_norm for update;
  if not found then raise exception 'code_not_found'; end if;
  if not v_code.active then raise exception 'code_inactive'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    raise exception 'code_expired';
  end if;
  if v_code.max_redemptions is not null and v_code.redeemed_count >= v_code.max_redemptions then
    raise exception 'code_exhausted';
  end if;

  -- 무료 매장 전용: 유료 이용이 살아 있으면 거부. paid_until null + active 는 수동 무기한
  -- 부여 상태이므로 역시 거부(코드가 무기한을 유한으로 깎아버리는 사고 방지).
  select * into v_sub from public.unit_subscriptions s where s.unit_id = v_unit;
  if found and v_sub.plan in ('single', 'multi') and v_sub.status = 'active'
     and (v_sub.paid_until is null or v_sub.paid_until > now()) then
    raise exception 'already_paid';
  end if;

  begin
    insert into public.promo_redemptions (code, unit_id, redeemed_by)
    values (v_norm, v_unit, v_uid);
  exception when unique_violation then
    raise exception 'already_redeemed';
  end;

  update public.promo_codes c set redeemed_count = c.redeemed_count + 1 where c.code = v_norm;

  -- 활성화는 SSOT 한 곳(admin_activate_store)으로 — definer 라 EXECUTE 권한은 소유자 기준이라 호출 가능.
  return query
    select a.unit_id, a.status, a.paid_until, a.plan, v_code.days
    from public.admin_activate_store(v_unit, v_code.days, v_code.plan) a;
end $$;
-- ★0084 교훈: `from public` 회수만으론 Supabase 의 역할별 기본 grant 가 남는다 — 역할 명시 회수 후
--   필요한 역할(authenticated)에만 재부여.
revoke all on function public.redeem_promo_code(text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;

-- ── 적용 후 게이트 ───────────────────────────────────────────────────────────
--   node scripts/qa-promo-codes.mjs  (리딤 성공·매장당 1회·유료 매장 거부·중단/만료/소진 코드 거부·
--                                     직원 거부·클라 직접 테이블 접근 차단)
--   node scripts/qa-billing-tiers.mjs (admin_activate_store 를 새 경로가 부르므로 회귀 확인)
