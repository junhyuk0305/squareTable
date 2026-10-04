// 구글 로그인 버튼 노출 판정 — react-native 를 읽지 않는 순수 함수(scripts/qa-social-login.mjs 가 Node 로 검증한다).
// 상수는 store-policy.ts 의 SHOW_SOCIAL_LOGIN 이 이 함수로 만든다. 화면은 그 상수만 읽는다.
//
// 웹에서만 보인다.
//   - iOS: Guideline 4.8. 구글 로그인을 넣으면 Sign in with Apple 도 함께 넣어야 한다.
//   - 안드: 앱에 네이티브 구글 로그인 모듈이 없다. 버튼을 누르면 무한 로딩이었다(2026-10-04 Q1).
export function socialLoginVisible(os: string): boolean {
  return os === 'web';
}
