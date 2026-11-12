-- 0602_race_iap_event.sql — 같은 사장의 앱 구독 웹훅을 한 줄로 처리한다 (2026-11-12 · 결함 전수 점검 S1 · M4)
-- 옛 앱 호환: 안전 | apply_iap_event 는 service_role 전용(엣지 iap-webhook 만 부른다). 시그니처·반환·권한 그대로. 잠금 한 줄만 더한다.
--
-- 무엇이 틀렸나(qa:race:local 수정 전 RED):
--   M4  0263 은 "이 거래 행에 더 늦은 이벤트를 이미 반영했으면 옛 이벤트는 버린다"를 행을 잠그지 않고 읽어 판정했다.
--       새 EXPIRATION 이 처리 중(커밋 전)일 때 늦게 재전송된 옛 RENEWAL 이 오면 옛 last_event_at 을 보고 통과해 덮었다 → 최종 active(기대 expired).
--
-- 고친 것: 판정 전에 사장 단위 advisory 잠금을 잡는다.
--   거래 행 for update 가 아니라 사장 단위인 까닭: ① 처음 보는 거래(행 없음)의 첫 이벤트 두 개도 줄을 서야 한다
--   ② 같은 사장의 다른 거래 이벤트(Play 상품 교체 = 새 거래 id)가 sync_iap_slots(사장 단위 대입)·옛 행 눕히기를 같이 쓴다.
--   웹훅은 사장당 드물어 직렬화 비용이 없다.
--   바뀐 줄에만 ★0602 를 단다.
-- 베이스(최고 번호 · grep 전수 확인 2026-11-12): apply_iap_event = 0263
-- 되돌리기: scripts/rollback/0602.sql

-- ════════════════════════════════════════════════════════════════════════════
-- apply_iap_event — 베이스 0263_iap_event_order.sql
-- ════════════════════════════════════════════════════════════════════════════
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
  v_evt_at  timestamptz;            -- ★0263(B7): 이 이벤트가 일어난 시각(RevenueCat event_timestamp_ms). 없으면 null.
begin
  if p_owner is null or coalesce(p_txn, '') = '' then raise exception 'bad_event'; end if;
  if p_platform not in ('play', 'appstore') then raise exception 'bad_platform'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;

  -- ★0602(M4): 사장 단위 잠금. 아래 last_event_at 비교(늦게 온 옛 이벤트 버리기)와 반영이 같은 사장의 다른 웹훅과 겹치지 않게
  --   읽기 전에 잡는다. 뒤 웹훅은 앞 웹훅이 커밋한 행을 보고 판정한다.
  perform pg_advisory_xact_lock(hashtextextended('iap_event:' || p_owner::text, 0));

  select * into v_cur from public.iap_subscriptions
   where platform = p_platform and original_transaction_id = p_txn;

  -- ★0263(B7): 그 거래 행에 이미 더 늦은 이벤트를 반영했다면 이 이벤트는 늦게 재전송된 옛 것이다 → 아무것도 바꾸지 않는다.
  if (p_raw -> 'event' ->> 'event_timestamp_ms') ~ '^[0-9]+$' then
    v_evt_at := to_timestamp((p_raw -> 'event' ->> 'event_timestamp_ms')::numeric / 1000);
  end if;
  if v_cur.id is not null and v_evt_at is not null and v_cur.last_event_at is not null
     and v_evt_at < v_cur.last_event_at then
    return jsonb_build_object('ok', true, 'type', p_type, 'stale', true, 'synced', false);
  end if;

  -- ── 줄이기 예고: 매장을 건드리지 않는다. expiration_at_ms 는 옛 상품 기준이라 쓰지 않는다. ──
  if p_type = 'PRODUCT_CHANGE' and v_cur.id is not null and p_count < v_cur.store_count then
    update public.iap_subscriptions
       set pending_product_id = p_product_id,
           pending_store_count = p_count,
           pending_at = v_cur.current_period_end,
           last_event_at = greatest(last_event_at, v_evt_at),   -- ★0263
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
    (owner_id, platform, product_id, store_count, original_transaction_id, status, current_period_end, raw, updated_at, last_event_at)
  values (p_owner, p_platform, v_prod, v_count, p_txn, v_status, v_end, p_raw, v_now, v_evt_at)
  on conflict (platform, original_transaction_id) do update set
    owner_id = excluded.owner_id,
    product_id = excluded.product_id,
    store_count = excluded.store_count,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    raw = coalesce(excluded.raw, iap_subscriptions.raw),
    updated_at = v_now,
    last_event_at = greatest(iap_subscriptions.last_event_at, excluded.last_event_at),   -- ★0263(B7)
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

do $$
begin
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)'::regprocedure)) = 0
     or position('last_event_at' in pg_get_functiondef('public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)'::regprocedure)) = 0 then
    raise exception '0602 자가점검 실패: apply_iap_event 잠금 또는 0263 순서 판정 없음';
  end if;
  if has_function_privilege('authenticated', 'public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)', 'execute') then
    raise exception '0602 자가점검 실패: apply_iap_event 클라 실행 가능';
  end if;
end $$;
