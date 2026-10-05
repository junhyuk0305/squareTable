-- 0259 · 환불은 그 거래로 연 몫만 회수한다(QA 논리 점검 2026-10-05 B1 · 약관 13조 "해당 이용권")
--
-- 예전: apply_iap_event 는 CUSTOMER_SUPPORT 환불이면 거래를 가리지 않고 revoke_iap_access(사장 단위)를 불렀다.
--   아이폰 구독이 끝난 뒤 카드(또는 Play)로 옮겨 쓰는 사장이 지난달 아이폰 결제를 환불받으면
--   카드로 돈을 내는 매장까지 바로 닫혔다(구독 흔적 source='iap' 는 카드·스토어 공용이다). 다음 갱신까지 열 길이 없다.
--   Play 요금제를 바꾸기 전 옛 거래(눕힌 행)를 환불받아도 같았다.
-- 지금: 환불된 거래가 지금 살아 있는 구독(active·grace·canceled 이고 기간이 남음)일 때만 회수한다.
--   다른 앱 구독(iap_subscription_live)이나 카드 구독(card_begin_subscribe 와 같은 술어)이 이어 가면 회수하지 않는다.
--   회수하지 않아도 그 거래 행은 refunded 로 적는다.
-- 운영자 카드 환불(card_record_refund p_revoke)도 같은 함수를 쓴다 → 앱 구독이 살아 있으면 매장을 회수하지 않는다
--   (카드 구독은 refunded 로 끝낸다).
-- 본문: apply_iap_event = 0235 · card_record_refund = 0230 통째 승계. 바뀐 곳은 ★0259 표시뿐이다.
-- 되돌리기: 0235 의 apply_iap_event · 0230 의 card_record_refund 를 다시 적용.

create or replace function public.apply_iap_event(
  p_owner      uuid,
  p_platform   text,
  p_txn        text,
  p_type       text,
  p_product_id text,
  p_plan       text,
  p_count      int,
  p_period_end timestamptz,               -- expiration_at_ms (null 가능)
  p_reason     text default null,         -- cancel_reason / expiration_reason
  p_grace_end  timestamptz default null,  -- grace_period_expiration_at_ms (BILLING_ISSUE)
  p_raw        jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hold    public.iap_subscriptions;  -- ★0206: 줄이기 예고가 걸린 옛 구독(교체 전)
  v_cur     public.iap_subscriptions;
  v_now     timestamptz := now();
  v_refund  boolean := p_type in ('CANCELLATION', 'EXPIRATION') and p_reason = 'CUSTOMER_SUPPORT';
  v_status  text;
  v_end     timestamptz;
  v_prod    text := p_product_id;
  v_plan    text := p_plan;
  v_count   int  := p_count;
  v_clear   boolean := p_type in ('RENEWAL', 'PRODUCT_CHANGE');
  v_continuing boolean;             -- ★0235: 같은 구독이 이어지는 결제인가(sync_iap_slots 가 고르는 매장이 달라진다)
begin
  if p_owner is null or coalesce(p_txn, '') = '' then raise exception 'bad_event'; end if;
  if p_platform not in ('play', 'appstore') then raise exception 'bad_platform'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;

  select * into v_cur from public.iap_subscriptions
   where platform = p_platform and original_transaction_id = p_txn;

  -- ── 줄이기 예고: 매장을 건드리지 않는다. expiration_at_ms 는 옛 상품 기준이라 쓰지 않는다. ──
  if p_type = 'PRODUCT_CHANGE' and v_cur.id is not null and p_count < v_cur.store_count then
    update public.iap_subscriptions
       set pending_product_id = p_product_id,
           pending_store_count = p_count,
           pending_at = v_cur.current_period_end,
           raw = coalesce(p_raw, raw),
           updated_at = v_now
     where id = v_cur.id;
    return jsonb_build_object('ok', true, 'type', p_type, 'pending', true, 'synced', false);
  end if;

  -- 유예: 상품·매장 수는 지금 것 그대로, 기간만 유예 종료일로.
  if p_type = 'BILLING_ISSUE' and v_cur.id is not null then
    v_prod := v_cur.product_id; v_count := v_cur.store_count;
    v_plan := case when v_cur.store_count = 1 then 'single' else 'multi' end;
  end if;

  -- ★★2026-09-19(2): Play 줄이기 교체본이 매장을 **즉시** 줄이던 것.
  --   Play 는 같은 구독의 기본 요금제끼리 바꿀 때 DEFERRED 를 거부하므로 줄이기에 WITHOUT_PRORATION 을 쓴다.
  --   그 모드는 **청구만 미루고 구독은 즉시 교체**한다 — 옛 구독이 끊기고 새 거래가 INITIAL_PURCHASE 로
  --   들어온다. 그대로 두면 서버가 첫 구매로 보고 줄어든 매장 수를 **오늘** 적용해,
  --   사장이 이미 낸 한 달치를 남겨둔 채 매장이 닫힌다(화면은 "다음 결제일부터·닫히는 매장 없음"이라 말한다).
  --   → 같은 사장에게 **이 상품으로 줄이겠다는 예고(pending)가 걸린 옛 구독**이 있으면,
  --     이번 행은 **줄이기 전 매장 수**로 열고 예고만 새 행으로 옮긴다. 확정은 다음 RENEWAL(설계대로).
  --   ⛔애플은 이 경로를 타지 않는다(교체해도 original_transaction_id 가 유지돼 PRODUCT_CHANGE 로만 온다).
  if p_type = 'INITIAL_PURCHASE' then
    select * into v_hold from public.iap_subscriptions
     where owner_id = p_owner
       and platform = p_platform
       and original_transaction_id <> p_txn
       and pending_store_count is not null
       and pending_store_count = p_count
       and pending_product_id = p_product_id
       and store_count > p_count
     order by current_period_end desc
     limit 1;
    if v_hold.id is not null then
      v_prod  := v_hold.product_id;
      v_count := v_hold.store_count;
      v_plan  := case when v_hold.store_count = 1 then 'single' else 'multi' end;
    end if;
  end if;

  v_status := case
    when v_refund then 'refunded'
    when p_type = 'EXPIRATION' then 'expired'
    when p_type = 'CANCELLATION' then 'canceled'
    when p_type = 'BILLING_ISSUE' then 'grace'
    else 'active'
  end;
  -- 기간 끝. EXPIRATION/CANCELLATION 은 expiration_at_ms 가 없을 수 있어 지금 시각으로 눕힌다.
  v_end := case
    when p_type = 'BILLING_ISSUE' then coalesce(p_grace_end, v_cur.current_period_end, p_period_end, v_now)
    else coalesce(p_period_end, v_now)
  end;

  -- ★0235: 이어지는 결제 = 이 거래가 이미 있고(active·grace·canceled) 16일 안에 끝났거나 아직 안 끝났다,
  --   또는 Play 줄이기 교체본(v_hold). 판정은 이번 이벤트를 반영하기 **전** 행(v_cur)으로 한다.
  --   ★(리뷰 ⑲-h) Play 는 상품을 바꾸면 거래 id 가 바뀌어 늘리기도 새 거래의 INITIAL_PURCHASE 로 온다 →
  --   같은 사장의 살아 있는(16일 창) 옛 Play 구독이 있으면 이어지는 결제로 본다. 옛 행은 아래에서야 expired 로 눕는다.
  v_continuing := (v_cur.id is not null
                   and v_cur.status in ('active', 'grace', 'canceled')
                   and v_cur.current_period_end > v_now - interval '16 days')
                  or v_hold.id is not null
                  or (p_type = 'INITIAL_PURCHASE' and p_platform = 'play' and exists (
                        select 1 from public.iap_subscriptions o
                         where o.owner_id = p_owner and o.platform = 'play'
                           and o.original_transaction_id <> p_txn
                           and o.status in ('active', 'grace', 'canceled')
                           and o.current_period_end > v_now - interval '16 days'));

  -- 구독 상태 한 행(계정·플랫폼·거래 기준). unique(platform, original_transaction_id) 가 재전송의 중복 행을 막는다.
  insert into public.iap_subscriptions
    (owner_id, platform, product_id, store_count, original_transaction_id, status, current_period_end, raw, updated_at)
  values (p_owner, p_platform, v_prod, v_count, p_txn, v_status, v_end, p_raw, v_now)
  on conflict (platform, original_transaction_id) do update set
    owner_id = excluded.owner_id,
    product_id = excluded.product_id,
    store_count = excluded.store_count,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    raw = coalesce(excluded.raw, iap_subscriptions.raw),
    updated_at = v_now,
    pending_product_id  = case when v_clear then null else iap_subscriptions.pending_product_id end,
    pending_store_count = case when v_clear then null else iap_subscriptions.pending_store_count end,
    pending_at          = case when v_clear then null else iap_subscriptions.pending_at end;

  -- ★0206: 줄이기 예고를 새 거래 행으로 옮긴다 — 다음 RENEWAL 이 이 행으로 오기 때문이다.
  if v_hold.id is not null then
    update public.iap_subscriptions
       set pending_product_id  = p_product_id,
           pending_store_count = p_count,
           pending_at          = coalesce(v_hold.pending_at, v_end),
           updated_at          = v_now
     where platform = p_platform and original_transaction_id = p_txn;
  end if;

  -- ★★2026-09-19: Play 구독 교체가 남기는 유령 행을 눕힌다.
  --   Play 는 **구독 상품을 갈아타면 original_transaction_id 가 바뀐다**(애플은 유지된다). 행은
  --   (platform, original_transaction_id) 단위라 옛 거래 행에는 그 뒤로 아무 이벤트도 오지 않아
  --   'active' 인 채 영원히 남는다. 2026-09-18 실기기: st_single → st_multi 갈아타기 한 번에
  --   active 행이 둘, 두 번에 셋이 됐다. 매장 수는 sync_iap_slots 가 owner 단위 **절대 대입**이라
  --   틀리지 않았지만, "활성 구독이 있나"를 행으로 묻는 판정(웹 결제·계좌이체 신고 차단·해지·환불)이
  --   오염된다.
  --   ⚠️ 이번 행보다 **늦게까지 유효한** 구독은 건드리지 않는다 — 웹훅이 순서를 바꿔 도착해도
  --      살아 있는 새 구독을 눕히지 않기 위해서다(멱등: 두 번 불려도 결과가 같다).
  if v_status = 'active' then
    update public.iap_subscriptions
       set status = 'expired', updated_at = v_now
     where owner_id = p_owner
       and platform = p_platform
       and original_transaction_id <> p_txn
       and status in ('active', 'grace')
       and current_period_end <= v_end;
  end if;

  -- ── 환불: 즉시 회수(0187 3-b). 멱등. ──
  -- ★0259(B1): 그 거래가 지금 살아 있는 구독일 때만 회수한다(판정은 이번 이벤트 반영 **전** 행 v_cur).
  --   이미 끝난(expired·refunded·기간 지남) 거래나 처음 보는 거래의 환불은 행만 refunded 로 적는다.
  --   다른 앱 구독이나 카드 구독이 이어 가면 그 매장은 그 돈으로 열려 있다 → 회수하지 않는다.
  if v_refund then
    if v_cur.id is not null
       and v_cur.status in ('active', 'grace', 'canceled')
       and v_cur.current_period_end > v_now
       and not public.iap_subscription_live(p_owner)
       and not exists (select 1 from public.card_subscriptions c
                        where c.owner_id = p_owner
                          and (c.status in ('active', 'past_due')
                               or (c.status = 'canceled' and c.current_period_end > v_now))) then
      perform public.revoke_iap_access(p_owner, v_plan);
      return jsonb_build_object('ok', true, 'type', p_type, 'reason', p_reason, 'revoked', true);
    end if;
    return jsonb_build_object('ok', true, 'type', p_type, 'reason', p_reason, 'revoked', false);
  end if;

  -- CANCELLATION = 다음 달에 안 낸다는 예고 → 기간 끝까지 그대로. EXPIRATION = 자연 만료(0115 가 free 로 강등).
  if v_status in ('canceled', 'expired') then
    return jsonb_build_object('ok', true, 'type', p_type, 'synced', false);
  end if;
  if v_end <= v_now then
    return jsonb_build_object('ok', true, 'type', p_type, 'synced', false, 'reason', 'period_ended');
  end if;

  -- 확정(대입 — 재전송에 안전). RENEWAL 이 줄이기라면 (3)의 정렬로 고른 매장이 연장에서 빠진다.
  perform public.sync_iap_slots(p_owner, v_plan, v_count, v_end, v_continuing);
  -- 명단은 한 번 쓰이면 끝(다음 구매가 옛 선택에 끌려가지 않게). 줄이기 취소(상향/동일 PRODUCT_CHANGE)도 비운다.
  if v_clear then delete from public.iap_release_choice where owner_id = p_owner; end if;

  return jsonb_build_object('ok', true, 'type', p_type, 'synced', true, 'status', v_status);
end $$;

revoke all on function public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)
  to service_role;

create or replace function public.card_record_refund(
  p_order_id      text,
  p_cancel_amount int,
  p_revoke        boolean,
  p_raw           jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pay  public.card_payments;
  v_sub  public.card_subscriptions;
  v_left int;
  v_n    int := 0;
begin
  select * into v_pay from public.card_payments where order_id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_pay.status not in ('done', 'partial_canceled') then raise exception 'not_refundable: %', v_pay.status; end if;
  if coalesce(p_cancel_amount, 0) < 1 then raise exception 'bad_amount'; end if;
  v_left := v_pay.amount_krw - v_pay.canceled_amount_krw;
  if p_cancel_amount > v_left then raise exception 'amount_exceeds_balance: %', v_left; end if;

  update public.card_payments
     set canceled_amount_krw = canceled_amount_krw + p_cancel_amount,
         status = case when canceled_amount_krw + p_cancel_amount >= amount_krw then 'canceled' else 'partial_canceled' end,
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('cancel', p_raw),
         updated_at = now()
   where order_id = p_order_id;

  if coalesce(p_revoke, false) and v_pay.owner_id is not null then
    select * into v_sub from public.card_subscriptions where owner_id = v_pay.owner_id for update;
    if found then
      update public.card_subscriptions
         set status = 'refunded', next_charge_at = null, pending_plan = null, pending_store_count = null,
             charging_at = null, updated_at = now()
       where owner_id = v_pay.owner_id;
      -- 구독 채널로 연 매장만 닫는다(계좌이체·무료지급으로 연 매장은 남는다) — 0196 revoke_iap_access.
      -- ★0259(B1): 앱 구독이 살아 있으면 흔적 매장은 그 구독 돈으로 열려 있다 → 매장은 회수하지 않는다.
      if not public.iap_subscription_live(v_pay.owner_id) then
        v_n := public.revoke_iap_access(v_pay.owner_id, v_sub.plan);
      end if;
      delete from public.iap_release_choice where owner_id = v_pay.owner_id;
    end if;
  end if;

  return jsonb_build_object('order_id', p_order_id, 'canceled_amount', p_cancel_amount, 'revoked_units', v_n);
end $$;
revoke all on function public.card_record_refund(text, int, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.card_record_refund(text, int, boolean, jsonb) to service_role;
