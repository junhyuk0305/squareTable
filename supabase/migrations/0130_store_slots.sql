-- 0130_store_slots.sql — 다점포 = **매장 슬롯 선구매** 모델 (2026-08-11 사용자 결정)
--
-- ── 무엇이 잘못돼 있었나 ────────────────────────────────────────────────────
-- "몇 매장분을 사는가"가 **결제의 입력이 아니었다.** payment_claim_amount(0106)가
--   `count(unit_members where role='owner')` 로 **그때그때 소유 매장을 세서** 곱했다.
--   그래서 ① 이 결제가 몇 개분인지 시스템이 모르고 ② N개를 한 번에 살 방법이 없고
--   ③ 승인이 몇 개를 열어야 하는지도 알 수 없었다.
--   (0129 는 "소유한 전 매장을 연다"로 임시 봉합했는데, 그건 '매장 하나 추가 = 하나 결제'가
--    아니라 '추가할 때마다 전 매장 요금이 한꺼번에 청구'라 사용자 모델과 달랐다 → 여기서 폐기.)
--
-- ── 결정한 모델 ─────────────────────────────────────────────────────────────
--   ① 매장 슬롯을 **먼저 산다**. 슬롯 없이는 2번째+ 매장을 만들 수 없다
--      → "결제하고 나서 추가한 매장이 무료로 열리는" 경로가 **구조적으로 없다**.
--   ② 한 번에 N개를 살 수 있다(payment_claims.store_count).
--   ③ 만료일은 **매장마다 독립**이다(일할 계산 없음). 곧 PG 로 옮길 예정이라
--      정산 정교화는 그때 한다 — 지금은 뼈대를 세운다.
--
-- ── 슬롯의 수명 ─────────────────────────────────────────────────────────────
--   승인   → store_slots 에 store_count 개 적립(paid_until = now + months×30일)
--   자동배정 → 그 즉시 **무료·만료 상태인 내 매장**에 배정(신고 매장 우선, 그다음 오래된 순)
--             = 첫 결제·갱신이 별도 조작 없이 바로 반영된다
--   남은 것 → 미배정으로 대기 → create_store 가 하나씩 소비하며 새 매장을 연다
--
-- ★SSOT 경계: **배정된 슬롯의 기간은 unit_subscriptions 가 갖는다.** store_slots 는
--   '아직 매장에 붙지 않은 선불분'만 들고 있다(소비 후엔 감사용 흔적만). 한 슬롯이 두 곳에
--   동시에 기간을 갖는 상태가 없다 → effective_plan(0115)은 그대로 unit_subscriptions 만 본다.
--
-- ── 적용 후 게이트 ──────────────────────────────────────────────────────────
--   node scripts/tmp-qa-p8-slots.mjs · npm run qa:billing-tiers · qa:roles · qa:promo · qa:onboarding

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 결제 건에 "몇 매장분인가"를 넣는다
-- ════════════════════════════════════════════════════════════════════════════
alter table public.payment_claims
  add column if not exists store_count int not null default 1
    check (store_count between 1 and 15); -- 15 = create_store 의 안전 하드상한과 동일

comment on column public.payment_claims.store_count is
  '이 결제가 몇 매장분인가(multi 전용, single 은 항상 1). 승인 시 이 수만큼 슬롯이 적립된다.';

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 매장 슬롯 — 아직 매장에 붙지 않은 선불분
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.store_slots (
  id              uuid        primary key default gen_random_uuid(),
  owner_id        uuid        not null references auth.users (id) on delete cascade,
  paid_until      timestamptz not null,
  -- 어느 결제에서 왔나(돈의 출처 추적). 결제 행이 지워져도 슬롯은 남긴다.
  claim_id        uuid        references public.payment_claims (id) on delete set null,
  created_at      timestamptz not null default now(),
  -- 소비되면 여기 찍힌다. 행을 지우지 않는 이유 = 돈의 흐름이라 흔적이 남아야 한다.
  consumed_at     timestamptz,
  consumed_unit_id text       references public.units (id) on delete set null
);

-- 미사용 슬롯 조회가 유일한 뜨거운 경로.
create index if not exists store_slots_open_idx
  on public.store_slots (owner_id, paid_until) where consumed_at is null;

alter table public.store_slots enable row level security;

-- 사장은 **자기 슬롯 조회만** 가능(화면의 "남은 슬롯 N개"). 쓰기 경로는 클라에 없다 —
-- 적립은 review_payment_claim(service_role), 소비는 create_store(definer)만 한다.
drop policy if exists store_slots_select_own on public.store_slots;
create policy store_slots_select_own on public.store_slots
  for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.store_slots from anon, authenticated;
grant select on public.store_slots to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 금액 — 소유 매장을 세지 않고 **산 개수**를 곱한다
-- ════════════════════════════════════════════════════════════════════════════
-- ★구 시그니처를 drop 한다. 남겨 두면 오버로드로 해석돼 "개수를 안 넘기고 소유 수로 세는"
--   옛 경로가 그대로 열린다(0116 이 submit 에서 겪은 함정과 같다).
-- ★p_uid 를 뺐다 — 더 이상 누가 몇 매장을 소유했는지 볼 필요가 없다(그게 문제의 원인이었다).
--
-- ★★drop 전에 **RLS 정책 payment_claims_insert(0083)를 먼저 떼야 한다** — 그 정책의 WITH CHECK 가
--   이 함수를 부른다(PostgREST 직접 insert 로 금액을 위조하는 경로를 단독으로 막는 자물쇠).
--   떼고 새 시그니처로 **반드시 다시 건다**(아래 (3-b)). 안 걸면 금액 위조가 통째로 열린다.
drop policy if exists payment_claims_insert on public.payment_claims;
drop function if exists public.payment_claim_amount(uuid, text, int);

create or replace function public.payment_claim_amount(p_plan text, p_months int, p_store_count int default 1)
returns int language sql immutable set search_path = public as $$
  select case p_plan
    -- 19,000 + 부가세 1,900
    when 'single' then 20900 * greatest(coalesce(p_months, 1), 1)
    -- 29,000 + 부가세 2,900 — **매장당**. 곱하는 것은 '산 개수'다.
    when 'multi'  then 31900 * greatest(coalesce(p_months, 1), 1) * greatest(coalesce(p_store_count, 1), 1)
    else null
  end
$$;
-- ⚠️ 카운터파트: src/lib/config/tiers.ts 의 PLANS.*.monthlyKrw(공급가액) · VAT_RATE · withVat().
--    화면은 withVat(planMonthlyPrice(plan, storeCount)) 로 같은 값을 계산한다.
grant execute on function public.payment_claim_amount(text, int, int) to authenticated;

-- ── (3-b) 금액 위조 차단 정책 재장착 ────────────────────────────────────────
-- 0083 원문과 같은 자물쇠에 **store_count 를 더한 것**뿐이다. 이게 없으면 RPC 를 우회한
-- PostgREST 직접 insert 로 남의 매장 신고·'approved' 위조·금액 위조가 전부 열린다(0079 교훈).
create policy payment_claims_insert on public.payment_claims
  for insert to authenticated
  with check (
    claimed_by = (select auth.uid())
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and reject_reason is null
    -- ★개수까지 검사한다 — 안 그러면 "1매장분 금액으로 10매장분 슬롯"을 신고할 수 있다.
    and store_count between 1 and 15
    and (plan <> 'single' or store_count = 1)
    and amount_krw = public.payment_claim_amount(plan, months, store_count)
    and exists (
      select 1 from public.unit_members m
      where m.user_id = (select auth.uid())
        and m.unit_id = payment_claims.unit_id
        and m.role = 'owner'
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 신고 RPC — 몇 개분인지 받는다
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.submit_payment_claim(text, int, text, int, text, text, text, text);

create or replace function public.submit_payment_claim(
  p_plan          text,
  p_amount        int  default null,
  p_depositor     text default null,
  p_months        int  default 1,
  p_memo          text default null,
  p_terms_version text default null,
  p_biz_no        text default null,
  p_biz_email     text default null,
  p_store_count   int  default 1
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_months  int  := greatest(coalesce(p_months, 1), 1);
  v_count   int  := greatest(coalesce(p_store_count, 1), 1);
  v_dep     text := nullif(btrim(coalesce(p_depositor, '')), '');
  v_terms   text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_biz     text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_bizmail text := nullif(btrim(coalesce(p_biz_email, '')), '');
  v_amount  int;
  v_row     public.payment_claims;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan: %', p_plan; end if;
  if v_months > 12 then raise exception 'bad_months: %', v_months; end if;
  -- single 은 정의상 1매장(create_store 가 2번째를 막는다) → 개수를 강제로 1로 눕힌다.
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count: %', v_count; end if;
  if v_dep is null then raise exception 'depositor_required'; end if;
  -- ★동의 기록이 없는 주문은 만들지 않는다(0116). 화면 체크박스의 서버측 카운터파트.
  if v_terms is null then raise exception 'consent_required'; end if;
  if v_biz is not null and char_length(v_biz) <> 10 then raise exception 'bad_biz_no'; end if;

  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  v_amount := public.payment_claim_amount(p_plan, v_months, v_count);

  -- 중복 신고 = 기존 pending 갱신. created_at 은 보존(대기 경과시간, 0083 결정).
  update public.payment_claims c
     set plan = p_plan, amount_krw = v_amount, depositor_name = v_dep, months = v_months, memo = p_memo,
         terms_version = v_terms, agreed_at = now(), biz_no = v_biz, biz_email = v_bizmail,
         store_count = v_count
   where c.unit_id = v_unit and c.status = 'pending'
  returning c.* into v_row;
  if found then return v_row; end if;

  insert into public.payment_claims
    (unit_id, claimed_by, plan, amount_krw, depositor_name, months, memo,
     terms_version, agreed_at, biz_no, biz_email, store_count)
  values
    (v_unit, v_uid, p_plan, v_amount, v_dep, v_months, p_memo,
     v_terms, now(), v_biz, v_bizmail, v_count)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.submit_payment_claim(text, int, text, int, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.submit_payment_claim(text, int, text, int, text, text, text, text, int)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) 승인 — 슬롯 적립 + 무료·만료 매장에 자동 배정
-- ════════════════════════════════════════════════════════════════════════════
-- 0129(소유 전 매장 활성화)를 폐기하고 이 규칙으로 대체한다.
create or replace function public.review_payment_claim(
  p_id       uuid,
  p_approve  boolean,
  p_reason   text default null,
  p_reviewer text default null
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_row    public.payment_claims;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_until  timestamptz;
  v_unit   text;
  v_slot   uuid;
  i        int;
begin
  -- for update: 두 운영자가 동시에 승인해도 두 번 적립되지 않는다(아래 pending 검사와 한 쌍).
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'claim_not_found: %', p_id; end if;
  if v_row.status <> 'pending' then raise exception 'claim_not_pending: %', v_row.status; end if;
  if not coalesce(p_approve, false) and v_reason is null then raise exception 'reject_reason_required'; end if;

  if p_approve then
    if v_row.plan = 'single' then
      -- single = 1매장. 기존과 동일하게 신고 매장만 연다/연장한다.
      perform * from public.admin_activate_store(v_row.unit_id, v_row.months * 30, 'single');
    else
      -- ── multi: store_count 개 슬롯 적립 ──────────────────────────────────
      v_until := now() + make_interval(days => v_row.months * 30);
      for i in 1 .. greatest(coalesce(v_row.store_count, 1), 1) loop
        insert into public.store_slots (owner_id, paid_until, claim_id)
        values (v_row.claimed_by, v_until, v_row.id);
      end loop;

      -- ── 자동 배정: 무료·만료 상태인 내 매장에 (신고 매장 우선 → 오래된 순) ──
      -- 이게 없으면 첫 결제·갱신 때 "돈은 냈는데 매장이 안 열린" 구간이 생긴다.
      loop
        select u.id into v_unit
          from public.unit_members m
          join public.units u on u.id = m.unit_id
         where m.user_id = v_row.claimed_by and m.role = 'owner'
           and public.effective_plan(u.id) = 'free'
         order by (u.id = v_row.unit_id) desc, u.created_at asc
         limit 1;
        exit when v_unit is null;

        select id into v_slot
          from public.store_slots
         where owner_id = v_row.claimed_by and consumed_at is null and paid_until > now()
         order by paid_until asc
         limit 1
         for update skip locked;
        exit when v_slot is null;

        perform * from public.admin_activate_store(v_unit, v_row.months * 30, 'multi');
        update public.store_slots
           set consumed_at = now(), consumed_unit_id = v_unit
         where id = v_slot;
      end loop;
    end if;
  end if;

  update public.payment_claims set
    status        = case when p_approve then 'approved' else 'rejected' end,
    reviewed_at   = now(),
    reviewed_by   = nullif(btrim(coalesce(p_reviewer, '')), ''),
    reject_reason = case when p_approve then null else v_reason end
  where id = p_id
  returning * into v_row;
  return v_row;
end $$;
-- 로그인 사용자는 호출 불가 — 자기 신고를 스스로 승인하는 경로를 원천 차단(0084 의 교훈).
revoke all on function public.review_payment_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_payment_claim(uuid, boolean, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) create_store — 2번째+ 매장은 **슬롯을 소비**한다
-- ════════════════════════════════════════════════════════════════════════════
-- 정본 0115 본문에서 **매장 캡 블록과 구독 생성 블록만** 교체했다. 나머지 100% 동일(시그니처 포함).
-- ★"결제 후 추가한 매장이 무료로 열린다"를 여기서 닫는다 — 슬롯이 없으면 매장이 생기지 않는다.
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
  v_slot  uuid;
  v_until timestamptz;
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

  -- ★0130: 2번째 매장부터는 **미배정 슬롯**을 소비한다. FREE_MODE 면 우회(8월 전면 무료).
  --   옛 규칙(소유 매장이 전부 유효 multi)은 폐기 — 그 규칙은 "무료로 생긴 매장"을 허용했고,
  --   그래서 결제 뒤 추가분이 공짜로 열렸다.
  if not public.billing_free_mode() and v_owned >= 1 then
    select id, paid_until into v_slot, v_until
      from public.store_slots
     where owner_id = v_uid and consumed_at is null and paid_until > now()
     order by paid_until asc
     limit 1
     for update skip locked;
    -- named 에러: 화면이 "매장을 더 열려면 결제해 주세요"로 분기한다.
    if v_slot is null then raise exception 'no_store_slot'; end if;
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

  if v_slot is not null then
    -- 슬롯을 이 매장에 붙인다 — 기간은 **슬롯이 갖고 있던 만료일**(매장별 독립 만료일).
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
    values (v_unit, 'active', 'multi', v_until)
    on conflict (unit_id) do update set
      status = 'active', plan = 'multi', paid_until = excluded.paid_until, updated_at = now();
  else
    -- 첫 매장(또는 무료 모드) — 기존과 동일.
    insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
    select v_unit, 'trialing', now() + interval '3 days'
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  end if;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;
grant execute on function public.create_store(text, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) 화면용 — 내 남은 슬롯
-- ════════════════════════════════════════════════════════════════════════════
-- "매장 추가" 버튼이 열려 있는지, 몇 개나 더 만들 수 있는지 화면이 판정을 복제하지 않게.
create or replace function public.my_store_slots()
returns table(open_count int, next_paid_until timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(count(*), 0)::int, min(s.paid_until)
    from public.store_slots s
   where s.owner_id = (select auth.uid())
     and s.consumed_at is null
     and s.paid_until > now()
$$;
revoke all on function public.my_store_slots() from public, anon;
grant execute on function public.my_store_slots() to authenticated;
