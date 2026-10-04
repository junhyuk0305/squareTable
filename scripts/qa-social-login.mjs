#!/usr/bin/env node
// qa-social-login.mjs — 구글 로그인 버튼 노출 판정(src/lib/config/social-login.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 Q1: 안드 앱에서 "Google로 계속하기"를 누르면 무한 로딩이었다.
//   SHOW_SOCIAL_LOGIN = !IS_IOS_NATIVE 라 안드 앱에 버튼이 보였고, signInWithGoogle 은 앱에 없는
//   window.location 을 읽다 던졌고, onGoogle 에 finally 가 없어 busy 가 풀리지 않았다.
//   앱에는 네이티브 구글 로그인 모듈이 없다 → 버튼은 웹에서만 보인다.
// 실행: node scripts/qa-social-login.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

let socialLoginVisible = null;
try {
  ({ socialLoginVisible } = await import('../src/lib/config/social-login.ts'));
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}

console.log('\n■ 구글 로그인 버튼 — 웹에서만 보인다');
const vis = (os) => (typeof socialLoginVisible === 'function' ? socialLoginVisible(os) : undefined);
check("★socialLoginVisible('android') === false (안드 앱 무한 로딩)", vis('android') === false, `→ ${vis('android')}`);
check("socialLoginVisible('ios') === false (Guideline 4.8)", vis('ios') === false, `→ ${vis('ios')}`);
check("socialLoginVisible('web') === true (웹은 그대로)", vis('web') === true, `→ ${vis('web')}`);

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 || typeof socialLoginVisible !== 'function' ? 1 : 0);
