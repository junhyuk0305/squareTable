// sessionLoadPolicy.ts — 세션 로드를 "언제 돌리나"의 판정(SSOT · 순수 · supabase 없음). M3 2026-11-05.
//
// 왜 있나: 세션 로드(부팅 RPC 1회)가 필요 이상으로 돌았다.
//   · auth-js 2.110.2 는 onAuthStateChange 를 등록하는 순간 INITIAL_SESSION 을 다시 쏜다 → init 과 겹쳐 부팅에 2회.
//   · 웹은 탭이 hidden→visible 될 때마다 _recoverAndRefresh 가 유효 세션에 SIGNED_IN 을 재발화한다
//     → 포그라운드 새로고침(useForegroundRefresh)과 겹쳐 복귀마다 2회.
//   · 폴링(useMembershipSync)·명시 로드(signInWithPassword)·이벤트 로드가 같은 시각에 겹친다.
// 판정을 여기 한 곳에 두고, useSessionStore 는 결과만 따른다. qa:session 이 아래 진리표를 고정한다.
//
// ── authEventAction 진리표 ───────────────────────────────────────────────
//   INITIAL_SESSION (세션 있음)              → ignore  (init 이 getSession 으로 이미 로드했다)
//   INITIAL_SESSION (null)                   → ignore  (init 이 판정했다. auth-js 는 getSession 오류에도 null 로
//                                                        보내므로 받아들이면 오프라인 안내가 로그인 화면으로 덮인다 · Q26 · qa:boot-fault)
//   SIGNED_IN (다른 uid 또는 status≠signed_in) → load   (새 로그인 · 강제)
//   SIGNED_IN (같은 uid · signed_in)          → soft    (탭 복귀 재발화 · 진행 중이면 합치고 방금 성공했으면 생략)
//   TOKEN_REFRESHED · PASSWORD_RECOVERY · MFA_CHALLENGE_VERIFIED → ignore (신원·소속이 안 바뀐다)
//   USER_UPDATED                             → email   (auth 사용자 행만 바뀜 · 세션 email 만 갱신)
//   SIGNED_OUT                               → signout (기존 처리: 세대 올리고 SIGNED_OUT)
//   모르는 이벤트                            → ignore
//
// ── shouldStartLoad 진리표 ───────────────────────────────────────────────
//   expectedUnitId 있음(매장 전환)            → start   (전환 결과를 반드시 새로 읽는다)
//   soft=false(force · 쓰기 뒤 호출)          → start   (방금 쓴 것을 stale 로 생략하면 안 된다)
//   soft + 같은 사용자 로드 진행 중            → join    (그 Promise 를 같이 기다린다)
//   soft + 직전 성공이 LOAD_FRESH_MS 안        → skip
//   그 밖                                    → start

export type SessionLoadSource = 'init' | 'auth' | 'poll' | 'foreground' | 'write';

/** soft 로드가 "방금 성공했다"고 보는 창. 이 안에서는 다시 읽지 않는다. */
export const LOAD_FRESH_MS = 5000;
/** 소속 폴링 간격(useMembershipSync). publication 밖 사건(결제 활성·매장 닫힘·좌석 잠금·브랜드) 전용 · 사용자 결정 120초. */
export const MEMBERSHIP_POLL_MS = 120_000;

export type AuthEventAction = 'ignore' | 'load' | 'soft' | 'email' | 'signout';

export function authEventAction(
  evt: string,
  sessionUser: { id: string; email?: string } | null,
  state: { status: string; userId: string | null },
): AuthEventAction {
  switch (evt) {
    case 'INITIAL_SESSION':
      return 'ignore';
    case 'SIGNED_IN':
      if (!sessionUser) return 'ignore';
      return state.status === 'signed_in' && state.userId === sessionUser.id ? 'soft' : 'load';
    case 'USER_UPDATED':
      return 'email';
    case 'SIGNED_OUT':
      return 'signout';
    case 'TOKEN_REFRESHED':
    case 'PASSWORD_RECOVERY':
    case 'MFA_CHALLENGE_VERIFIED':
    default:
      return 'ignore';
  }
}

export function shouldStartLoad(p: {
  inflight: boolean;
  lastOkAt: number | null;
  now: number;
  soft: boolean;
  expectedUnitId?: string | null;
}): 'start' | 'join' | 'skip' {
  if (p.expectedUnitId !== undefined && p.expectedUnitId !== null) return 'start';
  if (!p.soft) return 'start';
  if (p.inflight) return 'join';
  if (p.lastOkAt !== null && p.now - p.lastOkAt < LOAD_FRESH_MS) return 'skip';
  return 'start';
}
