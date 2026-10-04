// 구독 해지 경로 문구 — react-native 를 읽지 않는 순수 함수(scripts/qa-cancel-path.mjs 가 Node 로 검증한다).
// 상수는 store-policy.ts 의 CANCEL_PATH_TEXT 가 이 함수로 만든다. 화면은 그 상수만 읽는다.
// 뒤에 "에서"를 붙여 쓴다.
//
// 2026-10-04 N-1: 안드 앱도 iOS 문구를 보였다. 안드 구독은 기기 설정이 아니라 Play 스토어 앱에서 해지한다.
// ⚠️Play 화면의 실제 메뉴 이름은 실기기에서 확인한다.
// ⛔웹은 지금 문구 그대로 둔다(토스 심사 동결 · /terms).
export function cancelPathText(os: string): string {
  if (os === 'android') return 'Play 스토어 앱의 결제 및 정기 결제 > 정기 결제';
  return '기기 설정의 구독 목록';
}
