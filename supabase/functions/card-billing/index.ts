// supabase/functions/card-billing/index.ts  (Deno / Supabase Edge Function)
// 웹 카드 정기결제(토스페이먼츠 빌링) — 토스 API 를 부르는 유일한 자리. 스키마·판정 = 0204_card_billing.sql.
//
// 역할 분담:
//   DB(0204)  = 무엇을 청구할지 정하고(금액·가드·선점), 결과를 반영한다(card_record_charge — 멱등).
//   여기      = 인증 + 토스 호출 + 결과 전달. 판정을 여기서 새로 하지 않는다.
//
// action
//   precheck     (사장 JWT)  카드 결제를 지금 열 수 있는가 — 카드 등록창을 띄우기 **전에** 묻는다
//   subscribe    (사장 JWT)  authKey → 빌링키 발급 → 첫 결제 → 매장 열기
//   change       (사장 JWT)  요금제·매장 수 변경(늘리기 = 차액 즉시 결제 · 줄이기 = 다음 결제일 예고)
//   update_card  (사장 JWT)  카드 바꾸기(새 authKey → 새 빌링키). 결제 실패 상태면 바로 재시도
//   renew        (service_role · pg_cron 매시) 대사 → 갱신 청구 → 끝난 빌링키 삭제
//
// ★테스트 키 안전장치: TOSS_SECRET_KEY 가 test_ 로 시작하면 **TOSS_TEST_OWNER_EMAILS 에 있는 계정만** 결제를 연다.
//   카드사 심사 기간엔 운영 사이트에 테스트 키가 붙는데, 그대로 두면 누구나 테스트 카드로 유료 매장을 공짜로 연다.
//
// ★결과를 모르면 실패로 적지 않는다: 네트워크 오류·5xx 는 pending 으로 두고 renew 가 주문번호로 토스에 조회해 대사한다.
//
// 배포:
//   supabase functions deploy card-billing
//   supabase secrets set TOSS_SECRET_KEY=... TOSS_TEST_OWNER_EMAILS=a@b.com,c@d.com ALLOWED_ORIGINS=https://dochackchack.com
//   node scripts/setup-card-billing-cron.mjs

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const TOSS_SECRET = Deno.env.get('TOSS_SECRET_KEY') ?? '';
const TOSS_API = Deno.env.get('TOSS_API_BASE') ?? 'https://api.tosspayments.com';
const LIVEMODE = TOSS_SECRET.startsWith('live_');
const TEST_OWNERS = (Deno.env.get('TOSS_TEST_OWNER_EMAILS') ?? '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://dochackchack.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

function corsFor(origin: string | null) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ── 토스 API ────────────────────────────────────────────────────────────────
type TossResult =
  | { kind: 'ok'; body: any }
  | { kind: 'declined'; code: string; message: string; body: any }   // 토스가 명확히 거절(4xx)
  | { kind: 'unknown'; message: string };                            // 결과 모름(네트워크·5xx) — pending 유지

async function toss(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, idem?: string): Promise<TossResult> {
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + btoa(TOSS_SECRET + ':'),
    'Content-Type': 'application/json',
  };
  if (idem) headers['Idempotency-Key'] = idem;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(TOSS_API + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    if (res.ok) return { kind: 'ok', body: parsed };
    if (res.status >= 500) return { kind: 'unknown', message: `toss_${res.status}` };
    return { kind: 'declined', code: parsed?.code ?? `HTTP_${res.status}`, message: parsed?.message ?? '', body: parsed };
  } catch (e) {
    return { kind: 'unknown', message: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

type ChargeArgs = {
  billingKey: string; customerKey: string; amount: number; orderId: string; orderName: string;
  email?: string | null; name?: string | null;
};
function chargeCard(a: ChargeArgs) {
  return toss('POST', `/v1/billing/${encodeURIComponent(a.billingKey)}`, {
    customerKey: a.customerKey,
    amount: a.amount,
    orderId: a.orderId,
    orderName: a.orderName.slice(0, 100),
    ...(a.email ? { customerEmail: a.email.slice(0, 100) } : {}),
    ...(a.name ? { customerName: a.name.slice(0, 100) } : {}),
    taxFreeAmount: 0,
  }, a.orderId);
}

// 토스 응답 → card_record_charge 인자. DONE 이 아니면(드물게 200 + 다른 상태) 실패로 적는다.
async function recordCharge(db: SupabaseClient, orderId: string, r: TossResult) {
  if (r.kind === 'unknown') return { status: 'pending', message: r.message };
  const ok = r.kind === 'ok' && r.body?.status === 'DONE';
  const { data, error } = await db.rpc('card_record_charge', {
    p_order_id: orderId,
    p_ok: ok,
    p_payment_key: r.kind === 'ok' ? r.body?.paymentKey ?? null : null,
    p_approved_at: r.kind === 'ok' ? r.body?.approvedAt ?? null : null,
    p_receipt_url: r.kind === 'ok' ? r.body?.receipt?.url ?? null : null,
    p_fail_code: ok ? null : (r.kind === 'declined' ? r.code : `STATUS_${r.body?.status ?? 'UNKNOWN'}`),
    p_fail_message: ok ? null : (r.kind === 'declined' ? r.message : '결제가 완료되지 않았어요'),
    p_raw: r.kind === 'unknown' ? null : r.body,
  });
  if (error) {
    // 토스는 승인했는데 DB 반영이 실패 — 매장이 안 열린 채 돈만 빠진 상태. renew 대사가 다시 시도한다(주문은 pending 그대로).
    console.error('[card-billing] record_failed', orderId, error.message);
    return { status: 'pending', message: 'record_failed' };
  }
  return data as { status: string; kind: string; fail_count?: number; period_end?: string };
}

// ── 인증 ────────────────────────────────────────────────────────────────────
async function authUser(req: Request): Promise<{ id: string; email: string } | null> {
  const authz = req.headers.get('Authorization') ?? '';
  if (!authz.toLowerCase().startsWith('bearer ')) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email ?? '').toLowerCase() };
}

function openFor(email: string): { open: boolean; reason?: string } {
  if (!TOSS_SECRET) return { open: false, reason: 'not_configured' };
  if (LIVEMODE) return { open: true };
  return TEST_OWNERS.includes(email) ? { open: true } : { open: false, reason: 'card_billing_not_open' };
}

// RPC named 에러 → 화면이 판정할 코드(클라 카운터파트 = src/lib/payments/cardBilling.ts CARD_ERROR_TEXT).
const NAMED = [
  'customer_key_mismatch', 'not_owner', 'bad_plan', 'bad_store_count', 'consent_required',
  'iap_subscription_active', 'card_subscription_exists', 'payment_claim_pending', 'payment_in_progress',
  'no_active_card_subscription', 'no_billing_key', 'release_required', 'release_mismatch',
];
const namedError = (msg: string) => NAMED.find((n) => msg.includes(n)) ?? 'unknown';

// ── renew: 대사 → 갱신 청구 → 빌링키 정리 ─────────────────────────────────────
async function reconcile(db: SupabaseClient) {
  const { data: stale } = await db.rpc('card_stale_pending', { p_livemode: LIVEMODE, p_minutes: 10 });
  let n = 0;
  for (const row of (stale ?? []) as { order_id: string }[]) {
    const r = await toss('GET', `/v1/payments/orders/${encodeURIComponent(row.order_id)}`);
    if (r.kind === 'unknown') continue;
    // 토스에 주문이 없다 = 승인 요청이 도달하지 않았다 → 실패로 닫는다(청구된 돈이 없다).
    if (r.kind === 'declined' && r.code !== 'NOT_FOUND_PAYMENT') continue;
    await recordCharge(db, row.order_id, r);
    n++;
  }
  return n;
}

async function chargeDue(db: SupabaseClient, owner: string | null) {
  const { data: due, error } = await db.rpc('card_claim_due', { p_livemode: LIVEMODE, p_owner: owner, p_limit: 20 });
  if (error) throw new Error('claim_due_failed: ' + error.message);
  const out: Record<string, number> = { done: 0, failed: 0, pending: 0 };
  for (const d of (due ?? []) as any[]) {
    const r = await chargeCard({
      billingKey: d.billing_key, customerKey: d.customer_key, amount: d.amount_krw,
      orderId: d.order_id, orderName: d.order_name, email: d.customer_email, name: d.customer_name,
    });
    const rec = await recordCharge(db, d.order_id, r);
    out[rec.status === 'done' ? 'done' : rec.status === 'failed' ? 'failed' : 'pending']++;
  }
  return out;
}

async function housekeeping(db: SupabaseClient) {
  const { data } = await db.rpc('card_housekeeping', { p_livemode: LIVEMODE });
  let n = 0;
  for (const k of (data ?? []) as { owner_id: string; billing_key: string }[]) {
    const r = await toss('DELETE', `/v1/billing/${encodeURIComponent(k.billing_key)}`);
    // 이미 없는 키(4xx)도 우리 쪽에서 비운다 — 다시 쓸 수 없는 키를 들고 있을 이유가 없다.
    if (r.kind === 'unknown') continue;
    await db.rpc('card_forget_billing_key', { p_owner: k.owner_id, p_billing_key: k.billing_key });
    n++;
  }
  return n;
}

// ── 빌링키 발급 ──────────────────────────────────────────────────────────────
async function issueBillingKey(db: SupabaseClient, ownerId: string, authKey: string, customerKey: string) {
  const r = await toss('POST', '/v1/billing/authorizations/issue', { authKey, customerKey });
  if (r.kind !== 'ok' || !r.body?.billingKey) {
    return { ok: false as const, code: r.kind === 'declined' ? r.code : 'toss_unavailable', message: r.kind === 'declined' ? r.message : '' };
  }
  const { error } = await db.rpc('card_save_billing_key', {
    p_owner: ownerId,
    p_customer_key: customerKey,
    p_billing_key: r.body.billingKey,
    p_card_company: r.body.cardCompany ?? r.body.card?.issuerCode ?? null,
    p_card_number: r.body.cardNumber ?? r.body.card?.number ?? null,
  });
  if (error) return { ok: false as const, code: namedError(error.message), message: '' };
  return { ok: true as const, billingKey: r.body.billingKey as string };
}

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const action = String(body?.action ?? '');
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ── 크론 ──
  if (action === 'renew') {
    if ((req.headers.get('Authorization') ?? '') !== `Bearer ${SERVICE_ROLE}`) return json({ error: 'unauthorized' }, 401);
    if (!TOSS_SECRET) return json({ error: 'not_configured' }, 500);
    try {
      const reconciled = await reconcile(db);
      const charged = await chargeDue(db, null);
      const keysDeleted = await housekeeping(db);
      return json({ ok: true, livemode: LIVEMODE, reconciled, charged, keysDeleted });
    } catch (e) {
      console.error('[card-billing] renew', e);
      return json({ error: 'renew_failed', detail: String((e as Error).message) }, 500);
    }
  }

  // ── 사장 ──
  const user = await authUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const gate = openFor(user.email);

  if (action === 'precheck') return json({ open: gate.open, reason: gate.reason ?? null, livemode: LIVEMODE });
  if (!gate.open) return json({ error: gate.reason }, 403);

  if (action === 'subscribe') {
    const authKey = String(body.authKey ?? '');
    const customerKey = String(body.customerKey ?? '');
    const plan = String(body.plan ?? '');
    const storeCount = Number(body.storeCount ?? 1);
    if (!authKey || !customerKey) return json({ error: 'bad_request' }, 400);

    // 가드를 **빌링키 발급 전에** 통과시킨다 — 막힐 주문이면 카드 키를 만들지 않는다.
    const { data: begun, error: beginErr } = await db.rpc('card_begin_subscribe', {
      p_owner: user.id, p_customer_key: customerKey, p_plan: plan, p_count: storeCount,
      p_terms_version: String(body.termsVersion ?? ''), p_livemode: LIVEMODE,
    });
    if (beginErr) return json({ error: namedError(beginErr.message) }, 409);
    const order = (begun as any[])[0];

    const issued = await issueBillingKey(db, user.id, authKey, customerKey);
    if (!issued.ok) {
      // 카드 등록 단계에서 막힘 — 결제는 시도하지 않았으니 주문을 실패로 닫는다.
      await db.rpc('card_record_charge', {
        p_order_id: order.order_id, p_ok: false, p_fail_code: issued.code, p_fail_message: issued.message || '카드 등록에 실패했어요',
      });
      return json({ error: 'card_register_failed', code: issued.code, message: issued.message }, 402);
    }

    const { data: prof } = await db.from('profiles').select('name').eq('id', user.id).maybeSingle();
    const r = await chargeCard({
      billingKey: issued.billingKey, customerKey, amount: order.amount_krw, orderId: order.order_id,
      orderName: order.order_name, email: user.email, name: prof?.name ?? null,
    });
    const rec = await recordCharge(db, order.order_id, r);
    if (rec.status === 'done') return json({ ok: true, status: 'done', orderId: order.order_id, amount: order.amount_krw, periodEnd: (rec as any).period_end });
    if (rec.status === 'failed') {
      return json({ error: 'charge_declined', code: r.kind === 'declined' ? r.code : null, message: r.kind === 'declined' ? r.message : '' }, 402);
    }
    return json({ ok: true, status: 'pending', orderId: order.order_id }, 202);
  }

  if (action === 'change') {
    // 줄이기 = 다음 결제일에 닫을 매장(사장이 고른 것). 개수·소속 판정은 DB(card_begin_change)가 한다.
    const release = Array.isArray(body.releaseUnits) ? body.releaseUnits.map((x: unknown) => String(x)) : null;
    const { data: ch, error: chErr } = await db.rpc('card_begin_change', {
      p_owner: user.id, p_plan: String(body.plan ?? ''), p_count: Number(body.storeCount ?? 1), p_release: release,
    });
    if (chErr) return json({ error: namedError(chErr.message) }, 409);
    const c = ch as any;
    if (c.mode !== 'charge') return json({ ok: true, ...c });
    const r = await chargeCard({
      billingKey: c.billing_key, customerKey: c.customer_key, amount: c.amount_krw, orderId: c.order_id,
      orderName: c.order_name, email: c.customer_email, name: c.customer_name,
    });
    const rec = await recordCharge(db, c.order_id, r);
    if (rec.status === 'done') return json({ ok: true, mode: 'charged', amount: c.amount_krw, nextAmount: c.next_amount_krw });
    if (rec.status === 'failed') {
      return json({ error: 'charge_declined', code: r.kind === 'declined' ? r.code : null, message: r.kind === 'declined' ? r.message : '' }, 402);
    }
    return json({ ok: true, mode: 'pending' }, 202);
  }

  if (action === 'update_card') {
    const authKey = String(body.authKey ?? '');
    const customerKey = String(body.customerKey ?? '');
    if (!authKey || !customerKey) return json({ error: 'bad_request' }, 400);
    const issued = await issueBillingKey(db, user.id, authKey, customerKey);
    if (!issued.ok) return json({ error: 'card_register_failed', code: issued.code, message: issued.message }, 402);
    const { data: retry } = await db.rpc('card_retry_now', { p_owner: user.id });
    if (!retry) return json({ ok: true, retried: false });
    const charged = await chargeDue(db, user.id);
    return json({ ok: true, retried: true, charged });
  }

  return json({ error: 'unknown_action' }, 400);
});
