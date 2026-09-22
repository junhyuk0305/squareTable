// 웹 카드 정기결제(토스페이먼츠 빌링) 클라이언트.
// 서버 = supabase/functions/card-billing(토스 호출) · supabase/migrations/0208_card_billing.sql(판정).
//
// ★웹 전용이다. 네이티브에서는 이 모듈의 함수를 부를 일이 없다(store-policy SHOW_CARD_BILLING=false).
//   iOS·Android 앱 안에서 카드 결제·외부 결제 안내가 한 글자도 나오면 스토어 규정 위반이다.
// ★엣지 호출은 raw fetch 로 한다 — supabase.functions.invoke 는 x-client-info 헤더를 붙여 CORS 프리플라이트가
//   실패한다(lib/push/notify.ts 주석 참조).
// ★토스 SDK 는 npm 패키지로 넣지 않고 공식 스크립트를 런타임에 불러온다 — 웹에서만 필요하고,
//   package-lock 을 바꾸면 네이티브 빌드(EAS npm ci)까지 흔든다.
import { supabase, HAS_SUPABASE } from '@/lib/supabase';

/** 토스 클라이언트 키(공개값). 비어 있으면 카드 결제 표면 자체를 그리지 않는다. */
export const TOSS_CLIENT_KEY = process.env.EXPO_PUBLIC_TOSS_CLIENT_KEY ?? '';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/card-billing` : '';
const SDK_URL = 'https://js.tosspayments.com/v2/standard';

/** 엣지·RPC 오류 코드 → 화면 문구. 판정은 여기 한 곳(§② SSOT). 서버 카운터파트 = card-billing NAMED. */
export const CARD_ERROR_TEXT: Record<string, string> = {
  card_billing_not_open: '카드 결제는 준비 중이에요. 지금은 계좌이체로 결제해 주세요.',
  not_configured: '카드 결제는 준비 중이에요. 지금은 계좌이체로 결제해 주세요.',
  not_owner: '사장님 계정에서만 결제할 수 있어요.',
  bad_plan: '유료 요금제를 먼저 선택해 주세요.',
  bad_store_count: '매장 개수를 다시 확인해 주세요.',
  consent_required: '자동결제 조건에 동의해 주세요.',
  customer_key_mismatch: '카드 등록 정보가 맞지 않아요. 요금제 화면에서 다시 시도해 주세요.',
  iap_subscription_active: '앱에서 구독 중인 요금제가 있어요. 앱 구독을 해지한 뒤 이어서 결제할 수 있어요.',
  card_subscription_exists: '이미 카드 자동결제를 이용 중이에요. 요금제 화면에서 변경할 수 있어요.',
  payment_claim_pending: '확인 중인 계좌이체 신청이 있어요. 확인이 끝난 뒤 카드로 바꿀 수 있어요.',
  payment_in_progress: '결제를 처리하고 있어요. 잠시 후 요금제 화면에서 확인해 주세요.',
  no_active_card_subscription: '이용 중인 카드 자동결제가 없어요.',
  not_resumable: '해지를 취소할 수 없어요. 이용 기간이 끝났다면 새로 결제해 주세요.',
  release_required: '다음 결제일에 닫을 매장을 골라 주세요.',
  release_mismatch: '닫을 매장을 다시 골라 주세요. 매장 목록이 바뀌었을 수 있어요.',
  card_register_failed: '카드를 등록하지 못했어요.',
  charge_declined: '카드 결제가 승인되지 않았어요.',
  unauthorized: '로그인이 풀렸어요. 다시 로그인해 주세요.',
  network: '연결이 불안정해요. 잠시 후 다시 시도해 주세요.',
  unknown: '카드 결제를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

/** 코드 문구 + 카드사가 준 사유(있으면). 사유를 숨기면 사장은 무엇을 바꿔야 할지 모른다(한도·정지 카드 등). */
export function cardErrorText(code?: string | null, reason?: string | null): string {
  const base = CARD_ERROR_TEXT[code ?? ''] ?? CARD_ERROR_TEXT.unknown;
  return reason ? `${base} (${reason})` : base;
}

/** RPC 오류 메시지에서 코드만 뽑는다. */
export function cardRpcErrorCode(message?: string): string {
  const m = message ?? '';
  return Object.keys(CARD_ERROR_TEXT).find((k) => m.includes(k)) ?? 'unknown';
}

export type CardEdgeResult = { ok: boolean; status: number; body: Record<string, any> };

async function callEdge(body: Record<string, unknown>): Promise<CardEdgeResult> {
  if (!HAS_SUPABASE || !ENDPOINT) return { ok: false, status: 0, body: { error: 'not_configured' } };
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, status: 401, body: { error: 'unauthorized' } };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { ok: res.ok, status: res.status, body: json };
  } catch {
    return { ok: false, status: 0, body: { error: 'network' } };
  }
}

export const cardPrecheck = () => callEdge({ action: 'precheck' });

export const cardSubscribe = (a: { authKey: string; customerKey: string; plan: 'single' | 'multi'; storeCount: number; termsVersion: string }) =>
  callEdge({ action: 'subscribe', ...a });

/** releaseUnits = 줄이기 때 다음 결제일에 닫을 매장(열린 매장 수 − 새 매장 수만큼). 늘리기·예고 취소엔 넘기지 않는다. */
export const cardChange = (a: { plan: 'single' | 'multi'; storeCount: number; releaseUnits?: string[] }) =>
  callEdge({ action: 'change', ...a });

export const cardUpdateCard = (a: { authKey: string; customerKey: string }) => callEdge({ action: 'update_card', ...a });

// ── 토스 SDK(v2) ─────────────────────────────────────────────────────────────
type TossFactory = (clientKey: string) => {
  payment: (o: { customerKey: string }) => {
    requestBillingAuth: (o: {
      method: 'CARD';
      successUrl: string;
      failUrl: string;
      customerEmail?: string;
      customerName?: string;
    }) => Promise<void>;
  };
};

let sdkPromise: Promise<TossFactory> | null = null;
function loadSdk(): Promise<TossFactory> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('web_only'));
  }
  const w = window as unknown as { TossPayments?: TossFactory };
  if (w.TossPayments) return Promise.resolve(w.TossPayments);
  if (!sdkPromise) {
    sdkPromise = new Promise<TossFactory>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = () => (w.TossPayments ? resolve(w.TossPayments) : reject(new Error('sdk_missing')));
      s.onerror = () => {
        sdkPromise = null; // 다음 시도에서 다시 불러오게
        reject(new Error('sdk_load_failed'));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

/**
 * 토스 카드 등록창(정기결제용)을 연다. 성공하면 브라우저가 successUrl 로 이동한다(이 함수는 돌아오지 않는다).
 * 반환값 = 창을 못 열었거나 사용자가 닫은 경우의 사유. 'cancel' 은 조용히 넘어간다.
 */
export async function openCardRegistration(a: {
  customerKey: string;
  successPath: string; // '/billing-card?mode=subscribe&plan=single&stores=1'
  customerEmail?: string | null;
  customerName?: string | null;
}): Promise<'cancel' | 'error'> {
  try {
    const TossPayments = await loadSdk();
    const origin = window.location.origin;
    const sep = a.successPath.includes('?') ? '&' : '?';
    await TossPayments(TOSS_CLIENT_KEY)
      .payment({ customerKey: a.customerKey })
      .requestBillingAuth({
        method: 'CARD',
        successUrl: `${origin}${a.successPath}`,
        failUrl: `${origin}${a.successPath}${sep}fail=1`,
        ...(a.customerEmail ? { customerEmail: a.customerEmail } : {}),
        ...(a.customerName ? { customerName: a.customerName } : {}),
      });
    return 'cancel';
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return code === 'USER_CANCEL' ? 'cancel' : 'error';
  }
}
