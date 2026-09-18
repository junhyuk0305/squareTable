// 이용권 "매장 수 바꾸기" 판정 — 순수 함수(RN import 없음). 검증: `npm run qa:iap-release`.
// 화면(IapPurchasePanel)이 이 결과로 버튼을 켜고 끈다.
//
// ★닫을 매장 수 = **열린 매장 − 새 매장 수**(0 미만이면 0). 구독 매장 수로 세면 안 된다.
//   서버 sync_iap_slots(0196)는 IAP 로 연 매장을 새 매장 수까지만 연장하고 넘치는 매장만 닫는다 —
//   매장이 새 매장 수 이하이면 닫히는 매장이 없다. 구독 수로 세던 때는 1곳 사장이 3곳을 사고 줄이면
//   후보(1곳)보다 많은 수를 골라야 해서 버튼이 영원히 안 눌렸다(2026-09-14).

export function releaseRule(p: {
  /** 서버가 아는 구독 매장 수(iap_subscriptions.store_count). 0 = 앱 구독 없음. */
  subscribed: number;
  /** 사장이 실제로 가진 열린 매장 수(닫을 매장 후보). */
  openStores: number;
  /** 고른 요금제의 매장 수. */
  target: number;
  /** 닫을 매장으로 체크한 수. */
  chosen: number;
}) {
  const isDown = p.subscribed > 0 && p.target < p.subscribed;
  const needRelease = isDown ? Math.max(0, p.openStores - p.target) : 0;
  return { isDown, needRelease, ready: !isDown || p.chosen === needRelease };
}
