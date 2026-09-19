// 인앱결제 구현(네이티브판) — RevenueCat SDK 래퍼. 화면은 이 모듈의 함수만 부른다.
// 웹판은 `purchases.web.ts`(전부 no-op) — Metro 가 웹 번들에서 SDK 를 아예 안 물게 하기 위함이다
// (네이티브 전용 모듈을 웹 경로에서 정적 import 하면 번들이 깨진다 — .claude/rules/platform.md).
//
// 이 파일은 "무엇을 파는가"를 모른다. 상품 목록·의미는 `src/lib/config/iap.ts` 한 곳이다.
// 결제 결과로 매장이 열리는 것은 **RevenueCat 웹훅 → sync_iap_slots** 경로다 —
// 앱이 직접 DB 를 고치지 않는다(앱을 믿으면 위조 구매로 매장이 열린다).

import Purchases, {
  LOG_LEVEL,
  STORE_REPLACEMENT_MODE,
  type PurchasesPackage,
  type CustomerInfo,
  type StoreProductChangeInfo,
} from 'react-native-purchases';
import { Platform } from 'react-native';
import { IAP_ENTITLEMENT, parseIapProduct } from '@/lib/config/iap';

const IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '';

/** 키가 없으면 IAP 를 켤 수 없다(빌드에 키를 안 넣은 상태) — 화면이 표면을 숨기는 근거. */
export const HAS_IAP = Boolean(Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY);

let configuredFor: string | null = null;

/**
 * SDK 초기화. 사용자 id 를 넘겨 **스토어 계정이 아니라 우리 계정에 구독이 붙게** 한다
 * — 웹훅이 받는 app_user_id 가 곧 `iap_subscriptions.owner_id` 다.
 */
export async function initPurchases(userId: string): Promise<void> {
  if (!HAS_IAP || !userId || configuredFor === userId) return;
  if (configuredFor === null) {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY, appUserID: userId });
  } else {
    // ★한 기기에서 계정을 바꾼 경우. 다시 configure 하지 않고 logIn 으로 갈아탄다 —
    //   안 하면 새로 로그인한 사장의 결제가 **이전 사용자 계정에 붙는다**(웹훅이 받는 app_user_id 가 그것이다).
    await Purchases.logIn(userId);
  }
  configuredFor = userId;
}

export type IapOffer = {
  /** 화면 표시용 — 스토어가 내려준 현지화 가격 문자열. ⛔앱에 가격을 하드코딩하지 않는다. */
  priceString: string;
  storeCount: number;
  planId: 'single' | 'multi';
  pkg: PurchasesPackage;
};

/**
 * 살 수 있는 요금제 목록. 상품 id 를 못 알아보면 **버린다**(콘솔에만 있고 코드가 모르는 상품을
 * 팔면 결제는 되는데 매장이 안 열린다 — 그 조합이 제일 나쁘다).
 */
export async function fetchOffers(): Promise<IapOffer[]> {
  if (!HAS_IAP) return [];
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  const offers: IapOffer[] = [];
  for (const pkg of packages) {
    const parsed = parseIapProduct(pkg.product.identifier);
    if (!parsed) continue;
    offers.push({ priceString: pkg.product.priceString, ...parsed, pkg });
  }
  return offers.sort((a, b) => a.storeCount - b.storeCount);
}

/**
 * Play 요금제 변경 정보(iOS 는 해당 없음 — 애플은 같은 구독 그룹 안의 갈아타기를 스토어가 알아서 한다).
 *
 * ★★넘기지 않으면 Play 는 **갈아타기가 아니라 구독을 하나 더 만든다** — 사장이 두 번 청구된다.
 *   그래서 "지금 구독"이 있으면 반드시 채운다. 문자열을 우리가 조립하지 않고 RC 가 준 id 를 그대로 쓴다.
 *
 * ★"갈아탈 구독이 있나"를 **우리 서버 행이 아니라 스토어에 묻는다.** 서버 행은 웹훅이 늦으면 아직 비어 있는데,
 *   그 사이에 사장이 다른 요금제를 고르면 "첫 구매"로 판정돼 구독이 두 개가 된다. 조회가 실패하면
 *   구매를 **중단**한다 — 갈아타기인지 모르는 채로 사면 두 번 청구되는 쪽이 더 큰 사고다.
 *
 *   - 늘리기 = CHARGE_PRORATED_PRICE: 즉시 적용하고 **남은 기간의 차액만** 오늘 받는다. 결제일은 그대로.
 *     Google 이 "더 비싼 등급으로 올릴 때" 공식 권장하는 모드이고 웹 SaaS 관행과도 같다(2026-09-18 사용자 결정).
 *     애플은 같은 자리에서 "전액 결제 + 남은 기간 환불 + 결제일 초기화"를 한다 — 스토어가 하는 일이 다르므로
 *     화면 문구도 갈린다(store-policy `UPGRADE_CREDIT`). ⚠️이 모드는 **올릴 때만** 쓸 수 있다.
 *   - 줄이기 = WITHOUT_PRORATION: 오늘 결제가 없고 **옛 구독 만료일에** 새 요금이 청구된다
 *     (애플과 같은 말이 된다 · 웹훅 PRODUCT_CHANGE=예고 → RENEWAL=확정).
 *     ★★2026-09-19 실기기: 여기에 DEFERRED 를 쓰면 **Play 가 결제 흐름을 거절한다**
 *       ("문제가 발생했습니다"). Play 는 **같은 구독 상품의 기본 요금제끼리 바꿀 때 DEFERRED 를
 *       지원하지 않는다** — 우리 줄이기는 전부 st_multi 안에서 일어나므로 항상 이 경우다.
 *       잘못된 replacement mode 는 조용히 무시되지 않고 구매 자체를 실패시킨다.
 *     ★RTDN 은 여전히 필요하다 — 확정(RENEWAL)이 웹훅으로 와야 매장이 실제로 줄어든다.
 */
async function playProductChange(downgrade: boolean): Promise<StoreProductChangeInfo | null> {
  const cur = await currentEntitlement();
  if (!cur.active || !cur.storeProductId) return null; // 첫 구매 — 갈아탈 구독이 없다
  return {
    oldProductIdentifier: cur.storeProductId,
    replacementMode: downgrade
      ? STORE_REPLACEMENT_MODE.WITHOUT_PRORATION
      : STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
  };
}

/**
 * 구매 또는 요금제 변경. **스토어 구독에는 수량이 없다** — "매장 더 추가"는 상위 요금제로 갈아타는 것이고,
 * 남은 기간 일할 정산은 스토어가 한다. 화면에는 그 사실을 드러내지 않는다.
 *
 * `downgrade` = 지금보다 적은 매장 수로 가는 것(화면이 이미 아는 판정을 그대로 받는다 — 여기서 다시 세지 않는다).
 */
export async function purchaseOffer(offer: IapOffer, opts?: { downgrade?: boolean }): Promise<CustomerInfo> {
  const change = Platform.OS === 'android' ? await playProductChange(Boolean(opts?.downgrade)) : null;
  const { customerInfo } = await Purchases.purchasePackage(offer.pkg, null, change);
  return customerInfo;
}

/** 구매 복원 — 없으면 양 스토어 모두 반려한다. */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/**
 * 구독 관리 창(해지·줄이기 취소·다시 이어가기). 앱은 구독을 직접 못 끊는다 — 스토어 창을 **앱 위에** 띄운다.
 * 결과는 웹훅(CANCELLATION/UNCANCELLATION/PRODUCT_CHANGE)으로 온다 — 여기서 상태를 바꾸지 않는다.
 */
export async function showManageSubscriptions(): Promise<void> {
  if (!HAS_IAP) return;
  await Purchases.showManageSubscriptions();
}

export type IapCurrent = {
  active: boolean;
  /** 지금 스토어 구독이 여는 매장 수. 모르는 상품이면 0(“모르면 안 연다”). */
  storeCount: number;
  /** Play 요금제 변경에 넘길 "지금 구독" id(iOS 는 쓰지 않는다). */
  storeProductId: string | null;
};

/**
 * 지금 스토어 구독이 살아 있는가(화면 표시용). 매장을 여는 판정은 서버가 한다.
 *
 * ★같은 물음에 답이 세 군데 있고 **형태가 다 다르다** — 용도별로 골라 쓴다(2026-09-18 실측·문서 확인):
 *   · 매장 수 = `productPlanIdentifier`(Play 는 요금제 id 에 들어 있다. 상품 id 는 `st_multi` 뿐이라
 *     그것만 보면 몇 매장인지 영영 모른다). 애플은 그 필드가 null 이고 상품 id 하나에 다 들어 있다.
 *   · 갈아탈 대상 id = `activeSubscriptions`(Play 는 `구독id:요금제id` 형태로 준다).
 *     ★Play 요금제 변경은 **이 형태를 요구한다** — `st_multi` 만 넘기면 지금 구독을 못 찾아
 *     갈아타기가 아니라 구독이 하나 더 생길 수 있다(RevenueCat 문서 Upgrades·Downgrades).
 *     우리가 문자열을 조립하지 않고 SDK 가 준 값을 그대로 쓴다.
 */
export async function currentEntitlement(): Promise<IapCurrent> {
  if (!HAS_IAP) return { active: false, storeCount: 0, storeProductId: null };
  const info = await Purchases.getCustomerInfo();
  const ent = info.entitlements.active[IAP_ENTITLEMENT];
  // 우리가 아는 상품인 구독만 갈아타기 대상으로 본다(모르는 구독을 옛 상품으로 넘기지 않는다).
  const known = (info.activeSubscriptions ?? []).find((s) => parseIapProduct(s));
  return {
    active: Boolean(ent),
    storeCount: parseIapProduct(ent?.productPlanIdentifier ?? ent?.productIdentifier ?? '')?.storeCount ?? 0,
    storeProductId: known ?? ent?.productIdentifier ?? null,
  };
}

/** 사용자가 취소 버튼을 눌렀을 뿐인가 — 이건 에러 토스트를 띄우면 안 된다. */
export function isUserCancelled(e: unknown): boolean {
  return Boolean((e as { userCancelled?: boolean })?.userCancelled);
}
