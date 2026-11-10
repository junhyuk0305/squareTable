// 구독 해지 경로 문구 — react-native 를 읽지 않는 순수 함수(scripts/qa-cancel-path.mjs 가 Node 로 검증한다).
// 상수는 store-policy.ts 의 CANCEL_PATH_TEXT 가 이 함수로 만든다. 화면은 그 상수만 읽는다.
// 뒤에 "에서"를 붙여 쓴다.
//
// 2026-10-04 N-1: 안드 앱도 iOS 문구를 보였다. 안드 구독은 기기 설정이 아니라 Play 스토어 앱에서 해지한다.
// ⚠️Play 화면의 실제 메뉴 이름은 실기기에서 확인한다.
// 웹 동결(토스 심사)은 2026-11-10 해제했다. 웹은 어느 기기에서 샀는지 모르니 산 기기의 스토어를 가리킨다.
//   웹에서도 결제 채널 말(카드·웹에서·토스)은 넣지 않는다. 이 문장은 앱 구독 해지 안내라서다.
export function cancelPathText(os: string): string {
  if (os === 'android') return 'Play 스토어 앱의 결제 및 정기 결제 > 정기 결제';
  if (os === 'web') return '이용권을 산 기기의 스토어 구독 메뉴';
  return '기기 설정의 구독 목록';
}
