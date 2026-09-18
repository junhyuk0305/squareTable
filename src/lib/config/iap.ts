// 인앱결제(IAP) 상품 SSOT — 스토어 콘솔에 등록한 상품/요금제 id 와 그 의미(플랜·매장 수).
// 설계 정본 = `출시서류_안드로이드/15_인앱결제_티어사다리_설계_2026-09-06.md`
//
// ★여기가 콘솔과 어긋나면 구매는 되는데 매장이 안 열린다. 웹훅이 상품 id 에서 매장 수를 파싱하므로
//   **명명 규칙을 바꾸면 서버(supabase/functions/iap-webhook)도 같이 바꿔야 한다.**
//   서버는 이 파일을 import 할 수 없으므로(Deno) 같은 규칙이 그쪽에 한 번 더 있다 — 둘은 한 쌍이다.
//
// ⛔ 가격을 여기 적지 않는다. 앱 가격(2026-09-13 결정 = 웹 × 1.3 천원 반올림 — 정본 출시서류_iOS/05 §5-②)은 웹 가격(tiers.ts)과 다르고,
//    두 숫자를 한 파일에 섞으면 반드시 갈라진다. 화면은 스토어가 내려주는 priceString 을 그대로 쓴다.

/** 스토어 구독 id. Play 는 구독 1개 안에 요금제 여러 개, App Store 는 구독 그룹 안에 상품 여러 개. */
export const IAP_SUBSCRIPTIONS = { single: 'st_single', multi: 'st_multi' } as const;

/**
 * 매장 수 → 요금제(기본 요금제/상품) id. 사다리 상한 5(설계 §7 E).
 *
 * ★Play 기본 요금제 id 에는 **밑줄을 못 쓴다**(소문자·숫자·하이픈만 — Play Console 규칙).
 *   그래서 콘솔에는 `single-1-monthly` 처럼 하이픈으로 넣고, 여기 표는 밑줄판 하나만 둔다
 *   — 아래 parse 가 하이픈을 밑줄로 바꿔 같은 표를 본다. 표를 둘로 늘리면 두 스토어가 갈라진다.
 */
export const IAP_PLANS: { storeCount: number; planId: 'single' | 'multi'; productId: string }[] = [
  // ★'single_monthly' 가 아니다 — 2026-09-13 App Store Connect 에서 삭제돼 애플이 그 id 를 영구 재사용 금지했다.
  { storeCount: 1, planId: 'single', productId: 'single_1_monthly' },
  { storeCount: 2, planId: 'multi', productId: 'multi_2_monthly' },
  { storeCount: 3, planId: 'multi', productId: 'multi_3_monthly' },
  { storeCount: 4, planId: 'multi', productId: 'multi_4_monthly' },
  { storeCount: 5, planId: 'multi', productId: 'multi_5_monthly' },
];

export const IAP_MAX_STORES = 5;

/** RevenueCat entitlement id — 5개 요금제가 전부 이 하나를 켠다. */
export const IAP_ENTITLEMENT = 'store_access';

/**
 * 스토어 상품 id → 플랜·매장 수. 파싱 실패는 null(서버·화면 둘 다 "모르면 안 연다").
 *
 * Play 는 `구독id:요금제id`(st_multi:multi-3-monthly) 형태로 내려주고 App Store 는 요금제 id 만 준다
 * — 콜론 뒤만 본다. Play 쪽 하이픈은 밑줄로 바꿔 한 표를 본다(위 ★).
 */
export function parseIapProduct(raw: string): { planId: 'single' | 'multi'; storeCount: number } | null {
  const id = ((raw ?? '').trim().split(':').pop() ?? '').replace(/-/g, '_');
  const hit = IAP_PLANS.find((p) => p.productId === id);
  return hit ? { planId: hit.planId, storeCount: hit.storeCount } : null;
}
