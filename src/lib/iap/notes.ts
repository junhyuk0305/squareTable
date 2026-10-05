// 이용권 패널의 안내 문구 판정 — 순수 함수만 둔다(SDK·DB·RN 을 import 하지 않는다).
// 검증 = scripts/qa-iap-notes.mjs. 화면(IapPurchasePanel)은 여기서 고른 문구를 그대로 그린다.
// ⛔ 앱 안 결제 화면이므로 다른 결제 채널을 말하지 않는다(App Store 3.1.1). 다른 모바일 플랫폼 이름도 쓰지 않는다(2.3.10).

/** "9월 13일" — 해를 넘기면 연도를 붙인다(결제 화면에서 지난 날짜로 읽히는 오해가 제일 위험하다). */
export function fmtDay(isoLike: string | null | undefined, now: number = Date.now()): string {
  if (!isoLike) return '';
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * A2 — 다른 경로로 산 이용 기간이 남아 있으면 앱에서 또 살 수 없다(없으면 null).
 * ★0187 의 이중청구 가드는 **한 방향**뿐이다(앱 구독 중이면 다른 신고를 막는다). 반대 방향은 서버가 안 막고
 *   `sync_iap_slots` 도 기간을 줄이지 않으므로 두 기간이 겹친 채 둘 다 청구된다 → 화면에서 **막는다**.
 * 2026-10-05 — 자동으로 이어지지 않는 기간이면 끝나기 3일 전부터는 막지 않는다.
 * Q30 — 그 기간이 자동으로 이어지는 중(`renewsElsewhere`)이면 "그 뒤에 여기서 이어가실 수 있어요"는 거짓이다.
 *   그때는 이어진다는 사실까지만 말한다. "여기서 따로 사지 않아도 돼요"는 인앱결제를 하지 말라는 말로 읽혀 넣지 않는다(정책 L3).
 * ⛔ 채널을 말하지 않는다 — 앱 안에서 외부 결제를 언급하면 스토어 위반이다.
 */
export function otherPaidNote(
  plan: string,
  paidUntil: string | null | undefined,
  renewsElsewhere: boolean,
  now: number = Date.now(),
): string | null {
  if (plan === 'free' || !paidUntil) return null;
  const ms = new Date(paidUntil).getTime();
  if (Number.isNaN(ms) || ms <= now) return null;
  if (renewsElsewhere) return `지금 이용권은 ${fmtDay(paidUntil, now)} 이후에도 자동으로 이어져요.`;
  // 2026-10-05: 선불 가드와 같은 기준. 끝나기 3일 전부터 산다(산 기간은 남은 기간 뒤에 붙는다 · 서버 0235).
  if (ms - now <= PREPAID_OPEN_BEFORE_MS) return null;
  return `${fmtDay(paidUntil, now)}까지 이용 기간이 남아 있어요. 끝나기 3일 전부터 결제할 수 있어요.`;
}

const PREPAID_OPEN_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 선불 기간이 남아 있으면 앱 결제를 잠근다(2026-10-05 결정 · 검증 = qa-iap-prepaid). 잠글 때만 문구, 아니면 null.
 * prepaidUntil = 서버 owner_prepaid_until(0251). null·undefined(옛 서버·읽기 실패)면 잠그지 않는다.
 * 끝나기 3일 전부터는 결제할 수 있다(카드 가드 0230 과 같은 기준). ⛔ 채널을 말하지 않는다.
 */
export function prepaidGuardNote(prepaidUntil: string | null | undefined, now: number = Date.now()): string | null {
  if (!prepaidUntil) return null;
  const ms = new Date(prepaidUntil).getTime();
  if (Number.isNaN(ms) || ms - now <= PREPAID_OPEN_BEFORE_MS) return null;
  return `이용 기간이 ${fmtDay(prepaidUntil, now)}까지 남아 있어요. 끝나기 3일 전부터 결제할 수 있어요.`;
}

/** 서버 행(`iap_subscriptions.platform`) 값. */
type SubPlatform = 'appstore' | 'play';

/** RevenueCat 권한의 store 값 → 서버 행 값. 우리가 파는 두 스토어만 안다(모르는 값은 막지 않는다). */
function fromEntStore(store: string | null | undefined): SubPlatform | null {
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'appstore';
  if (store === 'PLAY_STORE') return 'play';
  return null;
}

/**
 * Q8 — 지금 이용권을 다른 기기(다른 스토어)에서 샀으면 안내 문구, 아니면 null.
 * 문구가 있으면 화면은 구매 버튼과 관리 버튼을 잠근다. 늘리기는 두 번 청구가 되고,
 * 관리 창은 그 구독이 없는 스토어 창이 열리기 때문이다.
 *
 * - 1차 판정 = 서버 행의 platform. 2차 판정 = 스토어 권한의 store(웹훅이 늦어 서버 행이 아직 없을 때).
 * - os 는 Platform.OS. 웹은 해당 없음.
 * - 문구는 두 OS 공통 "다른 기기"다. 다른 모바일 플랫폼 이름을 앱에 쓰지 않는다(Apple 2.3.10).
 */
export function otherStoreNote(
  subPlatform: string | null | undefined,
  entStore: string | null | undefined,
  os: string,
  periodEnd?: string | null,
  now: number = Date.now(),
): string | null {
  const device: SubPlatform | null = os === 'ios' ? 'appstore' : os === 'android' ? 'play' : null;
  if (!device) return null;
  const bought: SubPlatform | null =
    subPlatform === 'appstore' || subPlatform === 'play' ? subPlatform : subPlatform ? null : fromEntStore(entStore);
  if (!bought || bought === device) return null;
  const base = '이 이용권은 다른 기기에서 산 거예요. 매장 수 바꾸기와 해지는 산 기기에서 해 주세요.';
  // 2026-10-05: 언제부터 이 기기에서 결제할 수 있는지(그 구독의 기간 끝 · 한국 날짜)를 붙인다. 끝난 구독은 잠그지 않는다.
  if (!periodEnd) return base;
  const ms = new Date(periodEnd).getTime();
  if (Number.isNaN(ms)) return base;
  if (ms <= now) return null;
  const k = new Date(ms + 9 * 3600000);
  const kNow = new Date(now + 9 * 3600000);
  const year = k.getUTCFullYear() !== kNow.getUTCFullYear() ? `${k.getUTCFullYear()}년 ` : '';
  return `${base} 이용 기간(${year}${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일)이 끝나면 이 기기에서 결제할 수 있어요.`;
}
