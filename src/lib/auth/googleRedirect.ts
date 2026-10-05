// 구글 로그인에서 돌아올 주소와 돌아온 주소의 code 판정 — react-native 를 읽지 않는 순수 함수
// (scripts/qa-social-login.mjs 가 Node 로 검증한다).
//
// 2026-10-04 Q1: 안드 앱에서 window.location.origin 을 읽다 TypeError 로 던져 무한 로딩이었다.
// 웹만 오리진을 읽고, 앱은 squaretable://auth/callback 을 쓴다. 읽다 던지면 null 을 돌려준다.
export function googleRedirectTo(
  os: string,
  deps: { origin: () => string | undefined; nativeUrl: () => string },
): string | null {
  try {
    return (os === 'web' ? deps.origin() : deps.nativeUrl()) || null;
  } catch {
    return null;
  }
}

/** 돌아온 주소의 ?code= 값. 없으면 null. */
export function callbackCode(url: string): string | null {
  const m = /[?&#]code=([^&#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
