// 인앱결제 구현(네이티브판) — RevenueCat SDK 래퍼. 화면은 이 모듈의 함수만 부른다.
// 웹판은 `purchases.web.ts`(전부 no-op) — Metro 가 웹 번들에서 SDK 를 아예 안 물게 하기 위함이다
// (네이티브 전용 모듈을 웹 경로에서 정적 import 하면 번들이 깨진다 — .claude/rules/platform.md).
//
// 이 파일은 "무엇을 파는가"를 모른다. 상품 목록·의미는 `src/lib/config/iap.ts` 한 곳이다.
// 결제 결과로 매장이 열리는 것은 **RevenueCat 웹훅 → sync_iap_slots** 경로다 —
// 앱이 직접 DB 를 고치지 않는다(앱을 믿으면 위조 구매로 매장이 열린다).

import Purchases, { LOG_LEVEL, type PurchasesPackage, type CustomerInfo } from 'react-native-purchases';
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
 * 구매 또는 요금제 변경. **스토어 구독에는 수량이 없다** — "매장 더 추가"는 상위 요금제로 갈아타는 것이고,
 * 남은 기간 일할 정산은 스토어가 한다. 화면에는 그 사실을 드러내지 않는다.
 */
export async function purchaseOffer(offer: IapOffer): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(offer.pkg);
  return customerInfo;
}

/** 구매 복원 — 없으면 양 스토어 모두 반려한다. */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/** 지금 스토어 구독이 살아 있는가(화면 표시용). 매장을 여는 판정은 서버가 한다. */
export async function currentEntitlement(): Promise<{ active: boolean; productId: string | null }> {
  if (!HAS_IAP) return { active: false, productId: null };
  const info = await Purchases.getCustomerInfo();
  const ent = info.entitlements.active[IAP_ENTITLEMENT];
  return { active: Boolean(ent), productId: ent?.productIdentifier ?? null };
}

/** 사용자가 취소 버튼을 눌렀을 뿐인가 — 이건 에러 토스트를 띄우면 안 된다. */
export function isUserCancelled(e: unknown): boolean {
  return Boolean((e as { userCancelled?: boolean })?.userCancelled);
}
