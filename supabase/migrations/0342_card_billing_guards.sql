-- 0342_card_billing_guards.sql — 카드 자동결제 매장 3개 상한 · 다점포 기간이 남은 사장의 단일 신청 거절 (2026-10-24 사용자 결정)
--
-- 옛 앱 호환: 안전 | 앱(ios-v1.1.0·android-v1.1.0)은 SHOW_BILLING=false 라 카드·계좌이체 화면을 그리지 않는다.
--   card_begin_subscribe·card_begin_change 는 service_role 전용(엣지만 부른다). submit_payment_claim 을 부르는 곳은
--   웹 billing 하나(src/lib/db.ts) — 옛 웹은 배포와 함께 바뀐다. 세 함수 모두 시그니처·권한 그대로, 거절 사유만 더한다.
--   새 함수 owner_multi_until·my_multi_until 은 추가만 한다.
--
-- ① 카드 매장 상한 3개 — 토스페이먼츠 빌링 계약 조건 "1회 10만 원 이하". 다점포 29,000 × 3 = 87,000 · × 4 = 116,000.
--    상한을 넘으면 'card_store_limit'. 계좌이체는 토스와 무관하므로 15개 그대로다.
--    클라 카운터파트 = src/lib/payments/cardBilling.ts CARD_MAX_STORES. 값을 바꾸면 둘을 같이 바꾼다.
-- ② 다점포 기간이 남은 사장의 단일 신청 거절 'multi_plan_active' — 카드 첫 결제·계좌이체 신고 둘 다.
--    이유: sync_iap_slots(0235)·계좌이체 승인은 단일을 받으면 그 매장의 요금제를 'single' 로 **덮는다**.
--    선불 기간은 carry 로 흡수되므로 남은 다점포 기간이 통째로 단일로 내려간다(2026-10-24 라이브 실결제에서 실제로 났다:
--    다점포 2027-07-30 → 단일 2027-08-30).
--    판정 = single_plan_locked(사장) = owner_multi_until(사장) 이 지금 + 3일보다 늦다.
--      owner_multi_until = 내 매장(사장 멤버십 · 지우지 않음 · 본사 부담 아님) 중 unit_subscriptions 가
--      multi · active · 기간 남음인 곳의 가장 늦은 만료일. 본사 부담 매장은 단일 경로가 고르지 않으므로 뺀다.
--      끝나기 3일 전부터 연다 = 앱 선불 잠금(2026-10-05 · 0251 · src/lib/iap/notes.ts PREPAID_OPEN_BEFORE_MS)과 같은 경계.
--      그 안에 단일을 사면 남은 3일 이하만 단일로 내려간다(사용자 결정 2026-10-24).
--    카드 구독 안의 줄이기(card_begin_change → single)는 막지 않는다 — 그 다점포는 카드 구독 자체가 낸 것이고 다음 결제일부터 바뀐다.
--    앱 인앱결제는 이 범위 밖이다(스토어가 먼저 돈을 받는다). 앱은 owner_prepaid_until(0251)로 선불 중 구매를 이미 잠근다.
--
-- 함수 본문 베이스 = 0230(세 함수 모두 최고 번호 정의 · grep 확인). 바뀐 줄에만 ★0342 를 단다.
-- 되돌리기: 0230 의 세 함수 정의(card_begin_subscribe·card_begin_change·submit_payment_claim)를 다시 실행하고
--   owner_multi_until(uuid)·my_multi_until() 을 drop 한다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) owner_multi_until — 다점포 기간이 남은 내 매장의 가장 늦은 만료일(없으면 null). 서버 판정의 SSOT.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.owner_multi_until(p_owner uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(us.paid_until)
    from public.unit_members m
    join public.units u on u.id = m.unit_id
    join public.unit_subscriptions us on us.unit_id = u.id
   where m.user_id = p_owner and m.role = 'owner'
     and u.deleted_at is null
     and us.plan = 'multi' and us.status = 'active' and us.paid_until > now()
     and not public.unit_brand_paid(u.id)
$$;
revoke all on function public.owner_multi_until(uuid) from public, anon, authenticated;
grant execute on function public.owner_multi_until(uuid) to service_role;

-- 단일 잠금 판정 — 서버 경계의 유일한 정의. 카드 첫 결제·계좌이체 신고가 이것만 부른다.
--   3일 = 클라 src/lib/iap/notes.ts PREPAID_OPEN_BEFORE_MS 와 같은 값이어야 한다(바꾸면 둘을 같이 바꾼다).
create or replace function public.single_plan_locked(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.owner_multi_until(p_owner) > now() + interval '3 days', false)
$$;
revoke all on function public.single_plan_locked(uuid) from public, anon, authenticated;
grant execute on function public.single_plan_locked(uuid) to service_role;

-- 화면용 — 로그인한 사장 본인 것만. 요금제 화면이 이 날짜와 같은 3일 경계로 단일 카드를 흐리게 하고 여는 날을 보여 준다.
create or replace function public.my_multi_until()
returns timestamptz language sql stable security definer set search_path = public as $$
  select public.owner_multi_until(auth.uid())
$$;
revoke all on function public.my_multi_until() from public, anon, authenticated;
grant execute on function public.my_multi_until() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) card_begin_subscribe — 첫 결제 주문 만들기(엣지 전용). 가드는 전부 여기 한 곳. (0230 본문 승계)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_begin_subscribe(
  p_owner         uuid,
  p_customer_key  text,
  p_plan          text,
  p_count         int,
  p_terms_version text,
  p_livemode      boolean
)
returns table(order_id text, amount_krw int, order_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_count int := greatest(coalesce(p_count, 1), 1);
  v_terms text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_sub   public.card_subscriptions;
  v_amt   int;
  v_order text;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if not exists (select 1 from public.card_billing_keys k where k.owner_id = p_owner and k.customer_key = p_customer_key) then
    raise exception 'customer_key_mismatch';
  end if;
  if not exists (select 1 from public.unit_members m where m.user_id = p_owner and m.role = 'owner') then
    raise exception 'not_owner';
  end if;
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if p_plan = 'single' then v_count := 1; end if;
  -- ★0342 ①: 카드는 매장 3개까지(토스 계약 1회 10만 원 이하). 4개부터는 도입 문의로 안내한다(화면).
  if v_count > 3 then raise exception 'card_store_limit'; end if;
  if v_terms is null then raise exception 'consent_required'; end if;
  -- ★0342 ②: 다점포 기간이 남았는데 단일을 사면 그 기간이 단일로 내려간다(sync_iap_slots 가 plan 을 덮는다).
  --   끝나기 3일 전부터는 연다(single_plan_locked).
  if p_plan = 'single' and public.single_plan_locked(p_owner) then
    raise exception 'multi_plan_active';
  end if;

  -- 앱 스토어 구독이 살아 있으면 카드로 또 받지 않는다(0197 가드의 반대 방향).
  if exists (
    select 1 from public.iap_subscriptions s
     where s.owner_id = p_owner and s.status in ('active', 'grace') and s.current_period_end > now()
  ) then
    raise exception 'iap_subscription_active';
  end if;

  -- 이미 카드 구독이 있으면 새로 만들지 않는다 — 해지 예약 중이면 "해지 취소", 요금 변경은 change 경로.
  select * into v_sub from public.card_subscriptions s where s.owner_id = p_owner;
  if found and (v_sub.status in ('active', 'past_due')
                or (v_sub.status = 'canceled' and v_sub.current_period_end > now())) then
    raise exception 'card_subscription_exists';
  end if;

  -- 계좌이체 신고가 확인 대기 중이면 두 번 내게 된다.
  if exists (
    select 1 from public.payment_claims c where c.claimed_by = p_owner and c.status = 'pending'
  ) then
    raise exception 'payment_claim_pending';
  end if;

  -- 더블 클릭·새로고침으로 첫 결제가 두 번 나가지 않게(진행 중 주문이 있으면 거부).
  if exists (
    select 1 from public.card_payments p
     where p.owner_id = p_owner and p.status = 'pending' and p.kind in ('first', 'upgrade')
       and p.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'payment_in_progress';
  end if;

  v_amt := public.payment_claim_amount(p_plan, 1, v_count);
  v_order := public.card_new_order_id('FP');

  insert into public.card_payments
    (order_id, owner_id, kind, plan, store_count, amount_krw, livemode, order_name, terms_version)
  values
    (v_order, p_owner, 'first', p_plan, v_count, v_amt, p_livemode, public.card_order_name(p_plan, v_count), v_terms);

  order_id := v_order;
  amount_krw := v_amt;
  order_name := public.card_order_name(p_plan, v_count);
  return next;
end $$;
revoke all on function public.card_begin_subscribe(uuid, text, text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.card_begin_subscribe(uuid, text, text, int, text, boolean) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) card_begin_change — 요금제·매장 수 바꾸기(엣지 전용). (0230 본문 승계)
--      줄이기 = 다음 결제일부터(예고만) · 늘리기 = 즉시, 남은 기간 차액을 일할로 결제.
--      ★보강(⑧, 0230): 4번째 인자 p_release = 줄이기 때 사장이 고른 "닫을 매장".
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_begin_change(p_owner uuid, p_plan text, p_count int, p_release text[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub   public.card_subscriptions;
  v_key   public.card_billing_keys;
  v_count int := greatest(coalesce(p_count, 1), 1);
  v_new   int;
  v_diff  int;
  v_order text;
  v_email text;
  v_name  text;
  v_open  text[];
  v_rel   text[];
  v_need  int;
begin
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count'; end if;

  select * into v_sub from public.card_subscriptions where owner_id = p_owner for update;
  if not found or v_sub.status <> 'active' or v_sub.current_period_end <= now() then
    raise exception 'no_active_card_subscription';
  end if;
  -- ★⑦ 앱 구독이 살아 있으면 카드 쪽 변경을 받지 않는다(다음 크론이 이 카드 구독을 멈춘다).
  if public.iap_subscription_live(p_owner) then raise exception 'iap_subscription_active'; end if;
  if v_sub.charging_at is not null and v_sub.charging_at > now() - interval '15 minutes' then
    raise exception 'payment_in_progress';
  end if;

  -- 지금과 같은 선택 = 예고 취소. 닫을 매장 명단도 같이 비운다(남기면 다음 갱신이 그 매장을 뺀다).
  if p_plan = v_sub.plan and v_count = v_sub.store_count then
    update public.card_subscriptions set pending_plan = null, pending_store_count = null, updated_at = now()
     where owner_id = p_owner;
    delete from public.iap_release_choice where owner_id = p_owner;
    return jsonb_build_object('mode', 'none');
  end if;

  -- ★0342 ①: 카드는 매장 3개까지 — 늘리기·줄이기 모두 바뀐 뒤 매장 수로 본다(갱신 금액도 이 값으로 나간다).
  --   예고 취소(위)보다 뒤에 둔다: 그 경로는 지금 상태를 유지할 뿐 새 금액을 만들지 않는다.
  if v_count > 3 then raise exception 'card_store_limit'; end if;

  v_new := public.payment_claim_amount(p_plan, 1, v_count);

  if v_new <= v_sub.amount_krw then
    -- ★⑧ 닫을 매장 — 후보 = 구독으로 연, 지금 열린 소유 매장(card_release_candidates). 닫을 수 = max(0, 후보 수 − 새 매장 수).
    --   구독 매장 수(store_count)로 세지 않는다: 3개를 사고 1곳만 만든 사장이 2개로 줄이면 닫을 곳이 없다
    --   (iOS IapPurchasePanel A-1 이 구독 수로 세서 줄이기 버튼이 영구 비활성이 된 결함 — 같은 실수를 하지 않는다).
    --   계좌이체로 연 매장은 후보가 아니다(구독 갱신이 닫지 못한다 — 위 함수 주석).
    --   개수·소속이 맞지 않으면 거부한다 — 서버가 대신 고르면(오래된 순) 사장이 남기려던 매장이 닫힌다.
    select coalesce(array_agg(c.unit_id), '{}') into v_open
      from public.card_release_candidates(p_owner) c;
    v_need := greatest(0, cardinality(v_open) - v_count);
    v_rel := array(select distinct x from unnest(p_release) x where x is not null);
    if v_need > 0 and cardinality(v_rel) = 0 then raise exception 'release_required'; end if;
    if cardinality(v_rel) <> v_need or not (v_rel <@ v_open) then raise exception 'release_mismatch'; end if;

    update public.card_subscriptions
       set pending_plan = p_plan, pending_store_count = v_count, updated_at = now()
     where owner_id = p_owner;
    delete from public.iap_release_choice where owner_id = p_owner;   -- 덮어쓰기(다시 고름)
    insert into public.iap_release_choice (owner_id, unit_id)
    select p_owner, x from unnest(v_rel) x;
    return jsonb_build_object('mode', 'scheduled', 'effective_at', v_sub.current_period_end, 'amount_krw', v_new,
                              'release', to_jsonb(v_rel));
  end if;

  if exists (
    select 1 from public.card_payments p
     where p.owner_id = p_owner and p.status = 'pending' and p.kind in ('first', 'upgrade')
       and p.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'payment_in_progress';
  end if;

  -- 차액 × 남은 기간 비율, 10원 단위 올림. 카드 최소 결제 100원.
  v_diff := greatest(100, (ceil(
              (v_new - v_sub.amount_krw)::numeric
              * extract(epoch from (v_sub.current_period_end - now()))
              / nullif(extract(epoch from (v_sub.current_period_end - v_sub.current_period_start)), 0)
              / 10) * 10)::int);

  select * into v_key from public.card_billing_keys where owner_id = p_owner;
  if v_key.billing_key is null then raise exception 'no_billing_key'; end if;
  select u.email into v_email from auth.users u where u.id = p_owner;
  select p.name into v_name from public.profiles p where p.id = p_owner;

  v_order := public.card_new_order_id('UP');
  insert into public.card_payments (order_id, owner_id, kind, plan, store_count, amount_krw, livemode, order_name, terms_version)
  values (v_order, p_owner, 'upgrade', p_plan, v_count, v_diff, v_sub.livemode,
          public.card_order_name(p_plan, v_count) || ' 변경 차액', v_sub.terms_version);

  return jsonb_build_object(
    'mode', 'charge', 'order_id', v_order, 'amount_krw', v_diff,
    'order_name', public.card_order_name(p_plan, v_count) || ' 변경 차액',
    'billing_key', v_key.billing_key, 'customer_key', v_key.customer_key,
    'customer_email', v_email, 'customer_name', v_name, 'next_amount_krw', v_new);
end $$;
revoke all on function public.card_begin_change(uuid, text, int, text[]) from public, anon, authenticated;
grant execute on function public.card_begin_change(uuid, text, int, text[]) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) submit_payment_claim — 계좌이체 신고. (0230 본문 승계 · 0187/0197/0208 가드 그대로)
-- ════════════════════════════════════════════════════════════════════════════
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

  -- ★이중 청구 차단(0187 → 0197). 앱 스토어 구독이 살아 있는 동안은 계좌이체 주문을 만들지 않는다.
  --   active = 자동갱신 중 · grace = 결제 실패 유예(애플이 재시도 중 — 성공하면 청구된다).
  --   canceled 는 통과: 기간 끝에 이어 붙이는 채널 전환 경로(명세 §3-5 D).
  --   클라 카운터파트: 웹 /billing 이 같은 두 상태에서 입금 신고 폼을 숨긴다.
  if exists (
    select 1 from public.iap_subscriptions
     where owner_id = v_uid and status in ('active', 'grace') and current_period_end > now()
  ) then
    raise exception 'iap_subscription_active';
  end if;

  -- ★0208: 카드 자동결제가 켜져 있거나 재시도 중이면 계좌이체를 받지 않는다. 해지 예약(canceled)은 통과(위와 같은 이유).
  if exists (
    select 1 from public.card_subscriptions
     where owner_id = v_uid and status in ('active', 'past_due')
  ) then
    raise exception 'card_subscription_active';
  end if;

  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan: %', p_plan; end if;
  if v_months > 12 then raise exception 'bad_months: %', v_months; end if;
  -- single 은 정의상 1매장(create_store 가 2번째를 막는다) → 개수를 강제로 1로 눕힌다.
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count: %', v_count; end if;
  -- ★0342 ②: 다점포 기간이 남았는데 단일을 신고하면 승인 때 그 매장이 단일로 내려간다. 끝나기 3일 전부터는 연다.
  if p_plan = 'single' and public.single_plan_locked(v_uid) then
    raise exception 'multi_plan_active';
  end if;
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
-- (5) 자가점검 — 본문 · 권한
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
begin
  if position('card_store_limit' in pg_get_functiondef('public.card_begin_subscribe(uuid, text, text, int, text, boolean)'::regprocedure)) = 0
     or position('multi_plan_active' in pg_get_functiondef('public.card_begin_subscribe(uuid, text, text, int, text, boolean)'::regprocedure)) = 0 then
    v_bad := v_bad || 'card_begin_subscribe(가드 없음) ';
  end if;
  if position('card_store_limit' in pg_get_functiondef('public.card_begin_change(uuid, text, int, text[])'::regprocedure)) = 0 then
    v_bad := v_bad || 'card_begin_change(상한 없음) ';
  end if;
  if position('multi_plan_active' in pg_get_functiondef('public.submit_payment_claim(text, int, text, int, text, text, text, text, int)'::regprocedure)) = 0 then
    v_bad := v_bad || 'submit_payment_claim(가드 없음) ';
  end if;
  if has_function_privilege('authenticated', 'public.owner_multi_until(uuid)', 'execute')
     or has_function_privilege('anon', 'public.owner_multi_until(uuid)', 'execute') then
    v_bad := v_bad || 'owner_multi_until(클라 실행가능) ';
  end if;
  if has_function_privilege('authenticated', 'public.single_plan_locked(uuid)', 'execute')
     or has_function_privilege('anon', 'public.single_plan_locked(uuid)', 'execute') then
    v_bad := v_bad || 'single_plan_locked(클라 실행가능) ';
  end if;
  if position('single_plan_locked' in pg_get_functiondef('public.card_begin_subscribe(uuid, text, text, int, text, boolean)'::regprocedure)) = 0
     or position('single_plan_locked' in pg_get_functiondef('public.submit_payment_claim(text, int, text, int, text, text, text, text, int)'::regprocedure)) = 0 then
    v_bad := v_bad || '단일 잠금이 single_plan_locked 를 안 씀 ';
  end if;
  if has_function_privilege('anon', 'public.my_multi_until()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_multi_until()', 'execute') then
    v_bad := v_bad || 'my_multi_until(권한) ';
  end if;
  if has_function_privilege('authenticated', 'public.card_begin_subscribe(uuid, text, text, int, text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.card_begin_change(uuid, text, int, text[])', 'execute') then
    v_bad := v_bad || 'card_begin_*(클라 실행가능) ';
  end if;
  if v_bad <> '' then raise exception '0342 자가점검 실패: %', v_bad; end if;
end $$;
