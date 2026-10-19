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

/**
 * 웹 루트('/')에 OAuth 복귀 흔적(?code= · ?error=)이 있는가.
 * 세션 없이 이게 남아 있으면 구글 로그인이 끝나지 않은 것이다(다른 브라우저·앱에서 시작했거나 취소).
 * 같은 규칙을 inject-landing-redirect.mjs 의 인라인 스크립트가 글자로 복제한다 — 바꾸면 둘 다 바꾼다.
 */
export function isLostOAuthReturn(search: string, hash: string): boolean {
  return /[?&#](code|error)=/.test(`${search}${hash}`);
}

/** 끊긴 OAuth 복귀를 보낼 곳. 로그인 화면이 이 표시를 보고 안내를 띄운다. */
export const OAUTH_LOST_HREF = '/login?oauth=lost';

/** 돌아온 주소의 ?code= 값. 없으면 null. */
export function callbackCode(url: string): string | null {
  const m = /[?&#]code=([^&#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
