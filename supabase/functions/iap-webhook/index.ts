// supabase/functions/iap-webhook/index.ts  (Deno / Supabase Edge Function)
// RevenueCat 웹훅 수신 — 스토어 인앱결제(IAP) 결과를 우리 구독 상태에 반영한다.
// 설계 정본 = `출시서류_안드로이드/15_인앱결제_티어사다리_설계_2026-09-06.md` §4 · 스키마 = 0187 · 0196.
//
// ★매장이 열리는 유일한 경로다. 앱은 결제만 하고 DB 를 고치지 않는다 —
//   앱을 믿으면 위조 구매로 매장이 열린다.
//
// ★2026-09-13(0196): 판정은 전부 DB 함수 `apply_iap_event` 가 한다. 여기는 **인증 + 파싱 + 호출**뿐이다.
//   이유 ① 예고(PRODUCT_CHANGE 하향)·확정(RENEWAL)·유예(BILLING_ISSUE)·환불 판정이 한 곳에 있어야 갈라지지 않는다
//        ② qa:iap 가 웹훅 시크릿 없이 **같은 코드 경로**를 라이브에서 검증한다
//        ③ 닫힘 알림(직원)이 DB 쪽 파생 판정이라 같은 층에 있어야 한다.
//
// 보안:
//   - Authorization 헤더가 RC_WEBHOOK_SECRET 과 정확히 일치해야 한다(RevenueCat 웹훅 설정의 Authorization 값).
//     시크릿 미설정이면 **전부 거부**한다 — 열어 두면 아무나 매장을 열 수 있다.
//   - service_role 로만 DB 를 만진다(apply_iap_event 는 service_role 전용).
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
  single_1_monthly: { plan: 'single', count: 1 },
  multi_2_monthly: { plan: 'multi', count: 2 },
  multi_3_monthly: { plan: 'multi', count: 3 },
  multi_4_monthly: { plan: 'multi', count: 4 },
  multi_5_monthly: { plan: 'multi', count: 5 },
};

// Play 는 `구독id:요금제id`(st_multi:multi-3-monthly), App Store 는 요금제 id 만 준다 — 콜론 뒤만 본다.
// ★Play 기본 요금제 id 는 밑줄을 못 써서 하이픈이다(콘솔 규칙) → 밑줄로 바꿔 위 표를 본다.
function parseProduct(raw: string) {
  const id = ((raw ?? '').trim().split(':').pop() ?? '').replace(/-/g, '_');
  return PRODUCTS[id] ? { id, ...PRODUCTS[id] } : null;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const msToIso = (ms: unknown): string | null => {
  const n = Number(ms ?? 0);
  return n > 0 ? new Date(n).toISOString() : null;
};

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
  // PRODUCT_CHANGE 는 바뀐 뒤 상품을 new_product_id 로 준다(product_id 는 바꾸기 **전** 상품) — 그게 있으면 그게 지금 파는 요금제다.
  const productId: string = ev.new_product_id ?? ev.product_id ?? '';
  const txn: string = ev.original_transaction_id ?? ev.transaction_id ?? '';
  const platform = ev.store === 'APP_STORE' ? 'appstore' : ev.store === 'PLAY_STORE' ? 'play' : null;

  // ── 이벤트 의미(근거 = RevenueCat 공식 웹훅 문서 Event Types and Fields, 2026-09-13 확인) ────────────
  //   · CANCELLATION 은 해지와 환불을 둘 다 실어 온다. 구분 = `cancel_reason`(EXPIRATION 은 `expiration_reason`).
  //     **CUSTOMER_SUPPORT 만 실제로 돈이 돌아간 것** → 즉시 회수. UNSUBSCRIBE = 다음 갱신을 끈 것 = 기간 끝까지 그대로.
  //   · PRODUCT_CHANGE 의 `expiration_at_ms` 는 바꾸기 전 상품 기준 — 줄이기에서 그 값으로 매장을 늘리거나 줄이지 않는다
  //     (판정은 apply_iap_event: 하향이면 예고만 기록, 확정은 결제일의 RENEWAL).
  //   · BILLING_ISSUE 의 `grace_period_expiration_at_ms` = 유예 종료(그 이벤트에만 있고 null 일 수 있다).
  //     ASC 에서 유예 16일을 켰으므로 애플은 그때까지 열어 둔다 — 우리도 그 날짜까지 연장(status='grace').
  const reason: string = ev.cancel_reason ?? ev.expiration_reason ?? '';

  // 우리가 처리하는 이벤트만 본다. 나머지(TEST·TRANSFER 등)는 200 으로 받고 흘린다 — 4xx 를 주면 RevenueCat 이 계속 재전송한다.
  // REFUND_REVERSED = 환불이 취소된 것(돈을 다시 받았다). 일반 경로를 타되 **미래 만료일이 실려 올 때만** 되살아난다.
  const HANDLED = [
    'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION',
    'CANCELLATION', 'EXPIRATION', 'REFUND_REVERSED', 'BILLING_ISSUE',
  ];
  if (!HANDLED.includes(type)) return json(200, { ok: true, skipped: type });

  if (!owner || !platform || !txn) return json(400, { error: 'bad_event' });

  const parsed = parseProduct(productId);
  // 모르는 상품 = 콘솔에만 있고 코드가 모르는 요금제. 매장을 여는 대신 실패로 남긴다
  // (조용히 200 을 주면 "결제는 됐는데 아무 일도 안 일어남"이 무음으로 묻힌다).
  if (!parsed) return json(400, { error: 'unknown_product', productId });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ★재전송이 와도 안전하다 — apply_iap_event 는 행 upsert + "지금 N개가 이 날짜까지 열려 있게 만든다"는
  //   **절대 상태 대입**이라 두 번 불러도 결과가 같다(가산이 아니다).
  const { data, error } = await db.rpc('apply_iap_event', {
    p_owner: owner,
    p_platform: platform,
    p_txn: txn,
    p_type: type,
    p_product_id: parsed.id,
    p_plan: parsed.plan,
    p_count: parsed.count,
    p_period_end: msToIso(ev.expiration_at_ms),
    p_reason: reason || null,
    p_grace_end: msToIso(ev.grace_period_expiration_at_ms),
    p_raw: payload,
  });
  if (error) return json(500, { error: 'apply_failed', detail: error.message });

  return json(200, { ...(data as Record<string, unknown>) });
});
