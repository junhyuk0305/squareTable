-- 0187_iap_subscriptions.sql — 인앱결제(IAP) 채널 (2026-09-06 초안)
--
-- ⛔ 미적용 초안이다. `supabase/migrations/` 밖에 있는 이유 = db push 가 상시라
--    설계 문서 §7 결정(A·B·C·E·F) 전에 스키마가 라이브로 나가면 안 된다.
--    설계 = `출시서류_안드로이드/15_인앱결제_티어사다리_설계_2026-09-06.md`
--    (번호 0186 은 `0186_retention_otp_inquiries.sql` 이 선점 — 같은 폴더의 보류분)
--
-- ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
-- 매장당 과금을 Play/App Store 에서 팔려면 **티어 사다리**(매장 수마다 별도 상품)뿐이다.
-- 구독에는 수량 개념이 없고 같은 상품의 중복 구매도 막힌다.
--
-- 다행히 0130 의 **매장 슬롯 선구매 모델**이 이미 "N매장분을 한 번에 산다"를 표현한다
-- (payment_claims.store_count · store_slots 는 owner_id 기준 = 계정 단위 = 스토어 구독과 같은 축).
-- → 상품 multi_3 = store_count 3. 새 도메인 개념을 만들지 않는다.
--
-- ── 그런데 두 군데가 안 맞는다 ──────────────────────────────────────────────
-- ① assign_open_slots(0137)의 배정 대상이 `effective_plan='free' or is_signup_trial` 이다.
--    수기 계좌이체는 **만료된 뒤에** 입금이 오니 맞았다. 스토어 구독은 **만료 전에 자동 갱신**된다
--    → 갱신 슬롯이 배정처를 못 찾고 남아돌다가 매장이 만료된다. **연장 경로가 따로 필요하다.**
-- ② 0130 은 "만료일은 매장마다 독립·일할 계산 없음"이다. 스토어 갱신일은 계정에 하나뿐이라
--    IAP 채널은 반대로 N개 매장의 paid_until 을 **갱신일 하나에 동기화**해야 한다.
--
-- ── 왜 payment_claims 에 얹지 않는가 ────────────────────────────────────────
-- payment_claims 는 계좌이체 전용이다: depositor_name NOT NULL,
-- payment_claims_one_pending_per_unit 이 매장당 pending 1건을 강제한다.
-- IAP 를 끼워넣으면 **가짜 입금자명**이 필요해지고, 0137 이 세운
-- "돈의 출처가 행에서 그대로 읽혀야 한다"와 정면으로 어긋난다. → 별도 테이블로 간다.
--
-- ⚠️ 적용 후 게이트: npm run qa:billing-tiers · qa:store-slots · qa:payment-claims · qa:promo

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 슬롯의 출처를 3종으로 — claim | grant | iap
-- ════════════════════════════════════════════════════════════════════════════
-- 지금은 `claim_id is null` 하나로 "무료 지급"을 구분한다(0137). IAP 는 **세 번째 출처**라
-- 그 표현으로는 부족하다 — claim_id 가 null 인데 무료가 아닌 행이 생긴다.
alter table public.store_slots
  add column if not exists source text not null default 'claim'
    check (source in ('claim', 'grant', 'iap'));

-- 기존 행 백필: claim_id 가 null 이면 무료 지급이었다.
update public.store_slots
   set source = 'grant'
 where claim_id is null and source = 'claim';

comment on column public.store_slots.source is
  '이 슬롯이 어디서 왔나. claim=계좌이체 승인 · grant=무료 지급(0137) · iap=스토어 인앱결제(0187).';

-- IAP 로 열린 매장을 되짚는 경로(갱신 시 연장 대상 조회). 이 조회가 새 뜨거운 경로다.
create index if not exists store_slots_iap_consumed_idx
  on public.store_slots (owner_id, consumed_unit_id)
  where source = 'iap' and consumed_at is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) iap_subscriptions — 스토어 구독의 현재 상태(계정당 플랫폼당 1행)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.iap_subscriptions (
  id            uuid        primary key default gen_random_uuid(),
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  platform      text        not null check (platform in ('play', 'appstore')),
  -- 스토어 상품/요금제 id. 여기서 매장 수를 파싱하므로 **명명 규칙을 바꾸면 웹훅이 깨진다**
  -- (single_monthly · multi_2_monthly … multi_5_monthly — 설계 §2).
  product_id    text        not null check (char_length(product_id) between 1 and 120),
  -- 상품에서 파생된 매장 수. 0130 의 payment_claims.store_count 와 같은 의미·같은 범위.
  store_count   int         not null check (store_count between 1 and 15),
  -- ★재전송 방어의 유일한 키. 웹훅은 재시도된다 — 이게 없으면 갱신 1건에 슬롯이 두 번 쌓인다.
  original_transaction_id text not null,
  -- 'canceled' = 다음 갱신을 껐을 뿐(기간 끝까지 쓴다) · 'refunded' = 돈을 돌려줬다(즉시 회수).
  -- 둘을 한 값으로 뭉치면 해지한 사람의 남은 기간을 빼앗거나, 환불받은 사람이 계속 쓰거나 둘 중 하나가 된다.
  status        text        not null check (status in ('active', 'canceled', 'refunded', 'expired')),
  -- 이 결제로 보장되는 기간의 끝. 배정된 매장들의 paid_until 이 전부 이 값으로 맞춰진다.
  current_period_end timestamptz not null,
  -- 원본 이벤트. 정산 분쟁·환불 대사 때 스토어와 맞출 근거가 우리 쪽에 남아야 한다.
  raw           jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 한 스토어 거래는 한 행이다(웹훅 재전송·중복 이벤트가 여기서 막힌다).
create unique index if not exists iap_subscriptions_txn_uidx
  on public.iap_subscriptions (platform, original_transaction_id);

-- "이 사장이 지금 스토어 구독 중인가" — 이중 청구 가드(4)와 화면이 쓴다.
create index if not exists iap_subscriptions_owner_active_idx
  on public.iap_subscriptions (owner_id) where status = 'active';

alter table public.iap_subscriptions enable row level security;

-- 본인 것만 읽는다. 쓰기는 웹훅(service_role)뿐 — 사용자가 스스로 구독을 만들 경로는 없다.
drop policy if exists iap_subscriptions_read on public.iap_subscriptions;
create policy iap_subscriptions_read on public.iap_subscriptions
  for select to authenticated using (owner_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- (3) sync_iap_slots — 최초구매·갱신·요금제변경이 전부 부르는 하나의 함수
-- ════════════════════════════════════════════════════════════════════════════
-- 왜 하나인가: 세 이벤트가 하는 일이 "지금 N개 매장이 p_period_end 까지 열려 있게 만든다"로 같다.
-- 세 갈래로 쪼개면 갱신에만 있고 요금제변경엔 없는 분기가 반드시 생긴다(0137 배정 루프와 같은 교훈).
--
-- ① 이미 IAP 로 연 매장의 paid_until 을 p_period_end 로 **맞춘다**  ← 0137 이 못 하던 것
-- ② 모자라면 슬롯을 새로 적립하고 assign_open_slots 로 배정한 뒤, 그 매장들도 같은 날짜로 맞춘다
-- ③ 남으면(다운그레이드) 손대지 않는다 → 다음 갱신일에 자연 만료(0115 가 free 로 강등)
--
-- ★★연장에 admin_activate_store 를 쓰지 않는다 — **그 함수는 일수를 더한다**(0062):
--     paid_until = greatest(paid_until, now()) + p_days
--   스토어 자동갱신은 **만료 전에** 오므로 paid_until 이 아직 미래다. 그대로 태우면 갱신 때마다
--   기간이 누적돼 실제 결제보다 앞서 나간다(몇 달이면 공짜 몇 달). 설계 §3 이 요구한 것은
--   "N개 매장의 paid_until 을 갱신일 하나에 **동기화**" = 대입이다 → unit_subscriptions 를 직접 맞춘다.
--   신규 배정 경로(assign_open_slots)는 가산이지만 대상이 무료·만료 매장(paid_until 이 과거)이라
--   결과가 now()+일수로 근사한다 — 그 오차도 ②의 정규화에서 정확한 날짜로 덮는다.
--
-- ★단일매장(single) 은 슬롯 경로를 타지 않는다.
--   assign_open_slots(0137)는 플랜을 **'multi' 로 하드코딩**한다 — 다점포 전용으로 만들어진 함수라
--   그게 맞았다. 그런데 IAP 는 single_monthly 도 판다(설계 §2 F). 그대로 태우면
--   단일매장 구독자에게 canUseMultistore 가 열려 **다점포 기능이 새어 나간다.**
--   single 은 슬롯 개념 자체가 없다(매장 1개) → 소유 매장을 'single' 로 직접 활성화한다.
create or replace function public.sync_iap_slots(
  p_owner      uuid,
  p_plan       text,          -- 'single' | 'multi' (상품 id 에서 파생)
  p_count      int,
  p_period_end timestamptz
)
returns table(extended int, granted int, assigned int)
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_units text[] := '{}';
  v_days  int;
  v_need  int;
  i       int;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;
  if p_plan = 'single' and p_count <> 1 then raise exception 'single_is_one_store'; end if;
  if p_period_end is null or p_period_end <= now() then raise exception 'bad_period_end'; end if;

  -- 신규 배정 경로(assign_open_slots)만 일수를 받는다. 갱신일까지의 남은 일수로 환산.
  v_days := greatest(1, ceil(extract(epoch from (p_period_end - now())) / 86400)::int);

  -- ── single: 배정 루프를 타지 않고 소유 매장 1곳을 직접 연다(최초구매·갱신이 같은 경로다) ──
  if p_plan = 'single' then
    select u.id into v_unit
      from public.unit_members m
      join public.units u on u.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
     order by u.created_at asc
     limit 1;
    if v_unit is null then raise exception 'no_owned_store'; end if;

    insert into public.unit_subscriptions (unit_id, status, paid_until, plan, updated_at)
    values (v_unit, 'active', p_period_end, 'single', now())
    on conflict (unit_id) do update set
      status = 'active', paid_until = excluded.paid_until, plan = 'single', updated_at = now();

    -- ★★2026-09-13: single 도 **이미 소비된 슬롯 행 하나를 남긴다.** 초안은 안 남겼고, 그것이
    --   single → multi 업그레이드를 조용히 죽였다:
    --     ① 사장이 single(1매장) 구독 → 1호점 plan='single', 슬롯 흔적 0
    --     ② multi_3 로 갈아탐 → 이 함수의 multi 분기 ①이 `source='iap'` 슬롯을 찾는데 **없다**
    --        → extended=0 → 슬롯 3개 신규 적립 → assign_open_slots 호출
    --     ③ assign_open_slots(0137)의 대상은 `effective_plan='free' or is_signup_trial` 인데
    --        1호점은 **유료 single** 이라 대상이 아니다 → assigned=0
    --     ④ 결과: 슬롯 3개가 배정처 없이 뜨고 1호점은 계속 'single' →
    --        `canUseMultistore` 가 false → **87,000원을 냈는데 매장이 하나도 안 늘어난다.**
    --   고치는 자리가 여기인 이유: 0137 은 계좌이체·무료지급과 **공유하는 배정 루프**라
    --   거기서 'single' 을 대상에 넣으면 IAP 와 무관한 두 채널의 의미까지 같이 바뀐다(AGENTS ②·db-rls).
    --   흔적을 남기는 쪽이 원인에 더 가깝다 — 설계 §11-5 #5("single 은 슬롯에 흔적이 없다")가
    --   한계로 적어 둔 바로 그것이 업그레이드를 막고 있었다. 여기서 그 한계 자체를 없앤다.
    --   ⚠️ 이 행은 **처음부터 소비된 상태**로 넣는다 — 미소비 슬롯이면 2호점 생성에 쓰여 공짜 매장이 된다.
    --   멱등: 갱신 때마다 불려도 이미 있으면 넣지 않는다.
    if not exists (
      select 1 from public.store_slots
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit
    ) then
      insert into public.store_slots (owner_id, paid_until, claim_id, source, consumed_at, consumed_unit_id)
      values (p_owner, p_period_end, null, 'iap', now(), v_unit);
    else
      update public.store_slots
         set paid_until = greatest(paid_until, p_period_end)
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit;
    end if;

    extended := 1; granted := 0; assigned := 0;
    return next;
    return;
  end if;

  -- ① 이 계정이 IAP 로 열어 둔 매장을 오래된 순으로 p_count 개까지 고른다.
  --    p_count 보다 많으면 초과분은 여기 안 들어온다 = 다운그레이드(③).
  select coalesce(array_agg(t.unit_id order by t.first_at asc), '{}')
    into v_units
    from (
      select s.consumed_unit_id as unit_id, min(s.consumed_at) as first_at
        from public.store_slots s
        join public.unit_members m
          on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
       where s.owner_id = p_owner and s.source = 'iap' and s.consumed_at is not null
         and s.consumed_unit_id is not null
       group by s.consumed_unit_id
       order by min(s.consumed_at) asc
       limit p_count
    ) t;

  -- 대입(가산 아님). 다만 이미 p_period_end 보다 먼 날짜면 줄이지 않는다 — 다른 채널(계좌이체·무료지급)이
  -- 더 길게 열어 둔 것을 IAP 갱신이 깎아버리면 사장 입장에선 산 것이 사라진다.
  update public.unit_subscriptions s
     set status = 'active',
         paid_until = greatest(coalesce(s.paid_until, p_period_end), p_period_end),
         plan = 'multi',
         updated_at = now()
   where s.unit_id = any(v_units);
  extended := coalesce(array_length(v_units, 1), 0);

  -- ② 모자란 만큼만 새 슬롯을 적립한다. claim_id 는 null 이지만 source='iap' 라
  --    무료 지급(grant)과 섞이지 않는다 — (1)이 그래서 필요했다.
  v_need := greatest(0, p_count - extended);
  for i in 1 .. v_need loop
    insert into public.store_slots (owner_id, paid_until, claim_id, source)
    values (p_owner, p_period_end, null, 'iap');
  end loop;
  granted := v_need;

  assigned := case when v_need > 0
                   then public.assign_open_slots(p_owner, v_days, null)
                   else 0 end;

  -- 방금 배정된 매장의 만료일을 스토어 갱신일에 정확히 맞춘다
  -- (assign_open_slots 는 now()+일수라 몇 시간 어긋난다).
  if assigned > 0 then
    update public.unit_subscriptions s
       set paid_until = p_period_end, updated_at = now()
      from (
        select s2.consumed_unit_id as unit_id
          from public.store_slots s2
         where s2.owner_id = p_owner and s2.source = 'iap' and s2.consumed_at is not null
           and s2.consumed_unit_id is not null
           and not (s2.consumed_unit_id = any(v_units))
         group by s2.consumed_unit_id
         order by min(s2.consumed_at) asc
         limit v_need
      ) n
     where s.unit_id = n.unit_id;
  end if;

  return next;
end $$;

-- 웹훅(service_role)만 부른다. 사용자가 스스로 매장을 여는 경로를 원천 차단(0084 의 교훈).
revoke all on function public.sync_iap_slots(uuid, text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_iap_slots(uuid, text, int, timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3-b) revoke_iap_access — **환불 즉시 회수.** sync_iap_slots 의 반대 방향이다.
--
-- 왜 sync_iap_slots 로 못 하는가(둘을 합치려다 실패한 자리다):
--   · 133행 `p_period_end <= now() → bad_period_end` — 지금 시각을 넣는 것 자체가 막혀 있다.
--   · 178행 `paid_until = greatest(기존, p_period_end)` — **줄이지 않는 것이 그 함수의 계약**이다
--     (다른 채널이 더 길게 열어 둔 것을 IAP 갱신이 깎지 않게 한 것). 회수는 정반대라 같은 함수에 못 얹는다.
--
-- ★자진 해지(UNSUBSCRIBE)는 여기 오지 않는다. 기간 끝까지 쓰는 것이 맞고, 그건 웹훅이 판정한다
--   (CANCELLATION + cancel_reason='CUSTOMER_SUPPORT' 만 환불이다 — RevenueCat 웹훅 문서).
--
-- ★"한 매장을 만료시킨다"는 판정은 **admin_expire_store(0036)가 SSOT** 다. 여기서 update 를 다시 쓰지 않는다
--   (`status='expired', paid_until=now()` 를 두 곳에 적으면 한쪽만 고쳐져 조용히 갈라진다).
--
-- 멱등: 이미 만료된 매장에 또 불려도 같은 값을 다시 쓸 뿐이라 결과가 같다.
create or replace function public.revoke_iap_access(
  p_owner uuid,
  p_plan  text            -- 'single' | 'multi' — 열어 준 경로가 달랐으므로 회수 경로도 대칭이다
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_units text[] := '{}';
  u       text;
  v_n     int := 0;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;

  if p_plan = 'single' then
    -- single 은 슬롯에 흔적이 없다(설계 §11-5 #5) → 연 것과 **같은 기준**으로 되찾는다:
    -- 소유 매장 중 가장 오래된 1곳. sync_iap_slots 138~146행과 같은 식이어야 어긋나지 않는다.
    select u2.id into v_unit
      from public.unit_members m
      join public.units u2 on u2.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
     order by u2.created_at asc
     limit 1;
    if v_unit is null then return 0; end if;
    v_units := array[v_unit];
  else
    -- multi 는 **IAP 로 연 매장만** 고른다. 계좌이체(source='claim')·무료지급('grant')으로 연 매장은
    -- 이 환불과 무관하므로 건드리면 안 된다 — 남의 돈으로 연 매장을 닫는 사고가 된다.
    select coalesce(array_agg(distinct s.consumed_unit_id), '{}')
      into v_units
      from public.store_slots s
      join public.unit_members m
        on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
     where s.owner_id = p_owner and s.source = 'iap'
       and s.consumed_at is not null and s.consumed_unit_id is not null;
  end if;

  foreach u in array v_units loop
    perform public.admin_expire_store(u);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

revoke all on function public.revoke_iap_access(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_iap_access(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 이중 청구 차단 — 스토어 구독 중이면 계좌이체 신고를 막는다
-- ════════════════════════════════════════════════════════════════════════════
-- 지금 구조로는 웹 PG/계좌이체 구독자와 앱 IAP 구독자가 같은 unit_subscriptions.plan 을 공유한다.
-- → 앱에서 구독 중인 사장이 웹에서 또 입금하면 **두 번 낸다.** 화면 안내로는 못 막는다(직접 RPC 경로).
--
-- 아래는 **0130 의 최신 정의를 그대로 옮기고 가드 한 덩어리만 더한 것**이다
-- (전수 확인: 0083 → 0116 → 0130 이 마지막). 시그니처·나머지 본문은 손대지 않았다 —
-- 바꾸면 계좌이체 경로가 조용히 달라진다.
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

  -- ★이중 청구 차단(0187). 앱 스토어 구독이 살아 있는 동안은 계좌이체 주문을 만들지 않는다.
  --   클라 카운터파트: "앱에서 결제 중이신 요금제가 있어요. 요금제 변경은 앱에서 해 주세요."
  --   (⛔ 웹 결제 유도 문구 금지 — 스토어 위반)
  if exists (
    select 1 from public.iap_subscriptions
     where owner_id = v_uid and status = 'active' and current_period_end > now()
  ) then
    raise exception 'iap_subscription_active';
  end if;

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
-- (5) 판매 스위치 — 문제가 생기면 앱을 다시 안 내고 되돌린다
-- ════════════════════════════════════════════════════════════════════════════
-- 네이티브는 OTA 가 없다(expo-updates 미사용). 빌드 상수(SHOW_IAP)만으로 막으면 되돌리는 데
-- 새 빌드 + 스토어 심사가 필요하다 — 며칠이다. 그동안 잘못된 가격·잘못된 배정이 계속 팔린다.
-- → 판매 여부를 **행 하나**로 둔다. 관리자가 REST 한 줄로 뒤집으면 다음 세션 갱신부터 표면이 사라진다.
--
-- ★fail-closed 다(행 없음·조회 실패 = 안 판다). billing_free_mode 는 반대로 fail-open(무료)인데,
--   그쪽은 "못 읽으면 안 잠근다"가 안전한 방향이고 이쪽은 "못 읽으면 안 판다"가 안전한 방향이다.
--   잘못 열린 결제는 환불·정산·신뢰가 걸리고, 잘못 닫힌 결제는 사장이 잠시 못 사는 것으로 끝난다.
--
-- ⚠️ 이 스위치는 **새로 파는 것만** 멈춘다. 이미 산 사람은 스토어가 계속 청구한다 —
--    진짜 판매 중단은 스토어 콘솔에서 상품을 내리고 기존 구독을 취소·환불하는 일이다.
--    그래서 웹훅(iap-webhook)은 이 값과 무관하게 계속 처리한다: 돈 낸 사람이 잠기는 쪽이 더 큰 사고다.
insert into public.app_config (key, value)
values ('iap_enabled', 'false')   -- ★기본 꺼짐. 스토어 관문을 통과한 뒤 사람이 켠다.
on conflict (key) do nothing;

create or replace function public.iap_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.value = 'true' from public.app_config c where c.key = 'iap_enabled'),
    false  -- 행 없음 = 판매 안 함(fail-closed)
  )
$$;
-- 노출되는 정보는 boolean 하나(무해). 판매 표면을 그리는 앱이 읽어야 한다.
grant execute on function public.iap_enabled() to authenticated;

-- ── 롤백 절차(운영) ─────────────────────────────────────────────────────────
--   판매 중단:  npm run iap:off      (= app_config.iap_enabled = 'false')
--   판매 재개:  npm run iap:on
--   전면 무료:  billing_free_mode = 'true'  — 결제와 무관하게 아무도 잠기지 않는다(0062).
--   ★두 스위치는 다른 것이다. iap_enabled 는 "앱에서 파는가", billing_free_mode 는 "돈을 받는가".
