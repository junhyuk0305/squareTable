// supabase/functions/iap-webhook/index.ts  (Deno / Supabase Edge Function)
// RevenueCat 웹훅 수신 — 스토어 인앱결제(IAP) 결과를 우리 구독 상태에 반영한다.
// 설계 정본 = `출시서류_안드로이드/15_인앱결제_티어사다리_설계_2026-09-06.md` §4 · 스키마 = 0187.
//
// ★매장이 열리는 유일한 경로다. 앱은 결제만 하고 DB 를 고치지 않는다 —
//   앱을 믿으면 위조 구매로 매장이 열린다.
//
// 보안:
//   - Authorization 헤더가 RC_WEBHOOK_SECRET 과 정확히 일치해야 한다(RevenueCat 웹훅 설정의 Authorization 값).
//     시크릿 미설정이면 **전부 거부**한다 — 열어 두면 아무나 매장을 열 수 있다.
//   - service_role 로만 DB 를 만진다(sync_iap_slots 는 service_role 전용).
//
// 배포:
//   supabase functions deploy iap-webhook --no-verify-jwt
//   supabase secrets set RC_WEBHOOK_SECRET=...
//   (--no-verify-jwt: RevenueCat 은 우리 JWT 를 못 만든다. 인증은 위 Authorization 헤더가 한다.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('RC_WEBHOOK_SECRET') ?? '';

// ⚠️ 상품 id 규칙의 클라이언트 카운터파트 = `src/lib/config/iap.ts`.
//    Deno 라 그 파일을 import 할 수 없다 — **둘은 한 쌍이고, 한쪽만 고치면 결제는 되는데 매장이 안 열린다.**
const PRODUCTS: Record<string, { plan: 'single' | 'multi'; count: number }> = {
  single_monthly: { plan: 'single', count: 1 },
  multi_2_monthly: { plan: 'multi', count: 2 },
  multi_3_monthly: { plan: 'multi', count: 3 },
  multi_4_monthly: { plan: 'multi', count: 4 },
  multi_5_monthly: { plan: 'multi', count: 5 },
};

// Play 는 `구독id:요금제id`(st_multi:multi_3_monthly), App Store 는 요금제 id 만 준다 — 콜론 뒤만 본다.
function parseProduct(raw: string) {
  const id = (raw ?? '').trim().split(':').pop() ?? '';
  return PRODUCTS[id] ?? null;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!WEBHOOK_SECRET) return json(500, { error: 'secret_not_configured' });
  if (req.headers.get('authorization') !== WEBHOOK_SECRET) return json(401, { error: 'unauthorized' });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }

  const ev = payload?.event ?? {};
  const type: string = ev.type ?? '';
  const owner: string = ev.app_user_id ?? '';
  // PRODUCT_CHANGE 는 바뀐 뒤 상품을 new_product_id 로 준다 — 그게 있으면 그게 지금 파는 요금제다.
  const productId: string = ev.new_product_id ?? ev.product_id ?? '';
  const txn: string = ev.original_transaction_id ?? ev.transaction_id ?? '';
  const platform = ev.store === 'APP_STORE' ? 'appstore' : ev.store === 'PLAY_STORE' ? 'play' : null;
  const periodEndMs: number = Number(ev.expiration_at_ms ?? 0);

  // ── 환불 판정 ────────────────────────────────────────────────────────────────
  // ★근거 = RevenueCat 공식 웹훅 문서(Event Types and Fields, 2026-09-12 확인).
  //   · CANCELLATION 은 **해지와 환불을 둘 다** 실어 온다 — "A subscription or non-renewing purchase was
  //     canceled or refunded. In the case of refunds, a subscription's auto-renewal setting may still be active."
  //   · 구분 필드는 `cancel_reason`(CANCELLATION) · `expiration_reason`(EXPIRATION).
  //     값은 UNSUBSCRIBE · BILLING_ERROR · DEVELOPER_INITIATED · PRICE_INCREASE · CUSTOMER_SUPPORT ·
  //     UNKNOWN · SUBSCRIPTION_PAUSED.
  //   · **CUSTOMER_SUPPORT 만 실제로 돈이 돌아간 것**이다 — "Customer received a refund from Apple support,
  //     a Google Play subscription was refunded through RevenueCat …". 환불이면 접근은 즉시 회수된다.
  //   · UNSUBSCRIBE = 사용자가 다음 갱신을 끈 것 = **기간 끝까지 그대로 쓴다**(현행 동작 유지).
  //     여기를 뭉뚱그리면 정상 결제한 사장의 남은 기간을 빼앗는다 — 이 파일에서 가장 위험한 실수다.
  // ⚠️미확정: 환불 CANCELLATION 의 `expiration_at_ms` 가 환불 시점인지 원래 만료일인지는 문서에 없다.
  //   → **그 값을 쓰지 않는다.** 회수는 DB 쪽에서 now() 로 눕히므로 이 필드에 의존할 필요가 없다.
  const reason: string = ev.cancel_reason ?? ev.expiration_reason ?? '';
  const isRefund = (type === 'CANCELLATION' || type === 'EXPIRATION') && reason === 'CUSTOMER_SUPPORT';

  // 우리가 처리하는 이벤트만 본다. 나머지(TEST·TRANSFER·BILLING_ISSUE 등)는 200 으로 받고 흘린다 —
  // 4xx 를 주면 RevenueCat 이 계속 재전송한다.
  // REFUND_REVERSED = 환불이 취소된 것(돈을 다시 받았다). 아래 일반 경로를 타되 **미래 만료일이 실려
  // 올 때만** 되살아난다 — 페이로드 형태를 실증하지 못해(문서에 필드 표가 없다) 값이 없으면 아무 일도
  // 안 하는 쪽으로 떨어지게 뒀다. 그 경우 복구는 사람 손이다(설계 §11-5 #4 와 같은 성격).
  const HANDLED = [
    'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION',
    'CANCELLATION', 'EXPIRATION', 'REFUND_REVERSED',
  ];
  if (!HANDLED.includes(type)) return json(200, { ok: true, skipped: type });

  if (!owner || !platform || !txn) return json(400, { error: 'bad_event' });

  const parsed = parseProduct(productId);
  // 모르는 상품 = 콘솔에만 있고 코드가 모르는 요금제. 매장을 여는 대신 실패로 남긴다
  // (조용히 200 을 주면 "결제는 됐는데 아무 일도 안 일어남"이 무음으로 묻힌다).
  if (!parsed) return json(400, { error: 'unknown_product', productId });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 기간 끝. EXPIRATION/CANCELLATION 은 expiration_at_ms 가 없을 수 있어 지금 시각으로 눕힌다.
  const periodEnd = new Date(periodEndMs > 0 ? periodEndMs : Date.now()).toISOString();
  const status = isRefund
    ? 'refunded'
    : type === 'EXPIRATION'
      ? 'expired'
      : type === 'CANCELLATION'
        ? 'canceled'
        : 'active';

  // 구독 상태 한 행(계정·플랫폼·거래 기준). unique(platform, original_transaction_id) 가
  // **웹훅 재전송에서 행이 두 개 생기는 것을 막는다.**
  const { error: upErr } = await db
    .from('iap_subscriptions')
    .upsert(
      {
        owner_id: owner,
        platform,
        product_id: productId,
        store_count: parsed.count,
        original_transaction_id: txn,
        status,
        current_period_end: periodEnd,
        raw: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform,original_transaction_id' },
    );
  if (upErr) return json(500, { error: 'upsert_failed', detail: upErr.message });

  // ── 환불: 즉시 회수 ────────────────────────────────────────────────────────
  // 돈을 돌려줬는데 서비스가 계속 열려 있으면 안 된다. paid_until 이 아직 미래라 자연 만료를 기다릴 수 없고,
  // sync_iap_slots 는 기간을 **줄이지 않는 것이 계약**이라 그쪽으로는 못 한다 → 전용 회수 함수(0187 3-b).
  // 멱등: 같은 환불 이벤트가 두 번 와도 같은 매장을 다시 눕힐 뿐이라 결과가 같다.
  if (isRefund) {
    const { error: revErr } = await db.rpc('revoke_iap_access', { p_owner: owner, p_plan: parsed.plan });
    if (revErr) return json(500, { error: 'revoke_failed', detail: revErr.message });
    return json(200, { ok: true, type, reason, revoked: true });
  }

  // CANCELLATION = "다음 달에 안 낸다"는 예고일 뿐이다(cancel_reason=UNSUBSCRIBE 등).
  // 기간 끝까지는 그대로 쓴다 → 슬롯을 건드리지 않는다.
  // EXPIRATION = 연장 중단. 별도 회수 없이 paid_until 이 지나면 0115 가 free 로 강등한다.
  if (status !== 'active') return json(200, { ok: true, type, synced: false });

  if (periodEndMs <= Date.now()) return json(200, { ok: true, type, synced: false, reason: 'period_ended' });

  // ★재전송이 와도 안전하다 — sync_iap_slots 는 "지금 N개가 이 날짜까지 열려 있게 만든다"는
  //   **절대 상태 대입**이라 두 번 불러도 결과가 같다(가산이 아니다).
  const { error: syncErr } = await db.rpc('sync_iap_slots', {
    p_owner: owner,
    p_plan: parsed.plan,
    p_count: parsed.count,
    p_period_end: periodEnd,
  });
  if (syncErr) return json(500, { error: 'sync_failed', detail: syncErr.message });

  return json(200, { ok: true, type, synced: true });
});
