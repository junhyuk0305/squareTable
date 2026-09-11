// 인앱결제 구현(웹판) — 웹에는 스토어 결제가 없다. 웹 결제 표면은 계좌이체/PG(`billing.tsx`)다.
// 전부 no-op 이지만 **조용한 no-op 은 금지**라 여기 이유를 남긴다(.claude/rules/platform.md 4번).
// 기본 파일(purchases.ts)이 네이티브판이고 이 파일이 예외판이다 — 확장자 쌍 규칙 그대로.

import type { PurchasesPackage, CustomerInfo } from 'react-native-purchases';

export const HAS_IAP = false;

export type IapOffer = {
  priceString: string;
  storeCount: number;
  planId: 'single' | 'multi';
  pkg: PurchasesPackage;
};

export async function initPurchases(_userId: string): Promise<void> {}

export async function fetchOffers(): Promise<IapOffer[]> {
  return [];
}

export async function purchaseOffer(_offer: IapOffer): Promise<CustomerInfo> {
  throw new Error('iap_not_available_on_web');
}

export async function restorePurchases(): Promise<CustomerInfo> {
  throw new Error('iap_not_available_on_web');
}

export async function currentEntitlement(): Promise<{ active: boolean; productId: string | null }> {
  return { active: false, productId: null };
}

export function isUserCancelled(_e: unknown): boolean {
  return false;
}
