// 스토어 결제·복원 오류 → 화면 문구. 순수 파일이다(SDK 를 import 하지 않는다 — 웹 번들·테스트에서도 읽힌다).
// 검증 = scripts/qa-iap-notes.mjs.
//
// A-10(10-04 결정): 구독은 **앱 계정에 묶는다.** RevenueCat 설정이 "Transfer if there are no active subscriptions"라
//   같은 Apple ID·Google 계정의 살아 있는 이용권을 다른 앱 계정으로 옮기지 않고 오류를 낸다.
//   그 오류를 일반 실패 문구로 덮으면 사장은 왜 안 되는지 모른다 → 어느 계정으로 로그인하면 되는지 말한다.
// RC 코드(@revenuecat/purchases-typescript-internal generated/error-codes.d.ts):
//   "6" PRODUCT_ALREADY_PURCHASED · "7" RECEIPT_ALREADY_IN_USE · "13" RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER

export type IapErrorKind = 'in_use' | 'already_owned' | 'other';

export function iapErrorKind(e: unknown): IapErrorKind {
  const raw = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  const code = raw === undefined || raw === null ? '' : String(raw);
  if (code === '7' || code === '13') return 'in_use';
  if (code === '6') return 'already_owned';
  return 'other';
}

/** 오류 종류별 문구. `other` 는 null — 화면이 그 자리의 일반 문구를 쓴다. os 는 Platform.OS. */
export function iapErrorText(kind: IapErrorKind, os: string): string | null {
  if (kind === 'in_use') {
    return os === 'ios'
      ? '이 Apple ID의 이용권은 다른 매장의 정석 계정에서 쓰고 있어요. 그 계정으로 로그인해 주세요.'
      : '이 Google 계정의 이용권은 다른 매장의 정석 계정에서 쓰고 있어요. 그 계정으로 로그인해 주세요.';
  }
  if (kind === 'already_owned') return '이미 구독 중인 이용권이 있어요. 다른 매장의 정석 계정에서 쓰고 있을 수 있어요.';
  return null;
}
