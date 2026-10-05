// sessionBootFault.ts — 부팅(세션 복원·프로필 첫 읽기)이 실패한 이유를 가른다 (Q26)
//
// 신호가 약한 곳에서 앱을 켜면 토큰은 기기에 살아 있는데도 읽기가 실패해 로그인 화면이 떴다.
// 오프라인이면 로그인 화면으로 보내지 않고 연결 안내를 보여 준다. 그 판정을 여기 한 곳에 둔다.
//   'offline'    = 연결 실패. 기기 세션은 그대로 두고 다시 시도한다.
//   'no_session' = 저장된 세션이 없거나 서버가 세션을 버렸다. 로그인 화면으로 간다.
//   'other'      = 그 밖의 실패(401·5xx 응답 등). 지금처럼 깨끗한 signed_out.
// 실패 경로에서만 부른다. 순수함수(무의존)라 scripts/qa-boot-fault.mjs 가 진리표를 고정한다.

export type BootFault = 'offline' | 'no_session' | 'other';

// fetch 가 연결 단계에서 던지는 TypeError 문구(RN · Chrome · Firefox · Safari · Node).
const NETWORK_MSG = /Network request failed|Failed to fetch|NetworkError when attempting to fetch|Load failed|fetch failed/i;

function isOffline(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown; code?: unknown; __isAuthError?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  // auth-js isAuthRetryableFetchError 와 같은 판정(연결 실패·502·503·504).
  if (e.__isAuthError === true && name === 'AuthRetryableFetchError') return true;
  // fetch 가 던진 TypeError 그대로.
  if (name === 'TypeError' && NETWORK_MSG.test(message)) return true;
  // PostgREST 는 연결 실패를 throw 하지 않고 { message: 'TypeError: ...', code: '' } 로 준다.
  if ((e.code === '' || e.code === undefined) && /^TypeError: /.test(message) && NETWORK_MSG.test(message)) return true;
  return false;
}

export function sessionBootFault(input: { error: unknown; hasSession: boolean }): BootFault {
  if (isOffline(input.error)) return 'offline';
  if (!input.hasSession) return 'no_session';
  return 'other';
}
