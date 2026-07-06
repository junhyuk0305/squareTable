// sessionReadFail.ts — loadProfile 읽기 실패 시 "보존 vs 리셋" 판정 (Finding B, §4.8·§4.10)
//
// supabase-js 는 쿼리 에러를 throw 하지 않고 {error} 로 준다. loadProfile 이 이 error 를 무시하면
// profile=null 로 흘러 role='junior'·unit_id='' 인 "빈 신원"이 signed_in 으로 세팅돼, 일시적
// 401/5xx/429 에 ① 사장이 직원으로 무음 강등(→'가게 만들기'로 튕김) ② 승인 대기 직원의 pending 유실
// 이 난다. 그래서 읽기 실패는 절대 "빈 상태=정상"으로 위장하지 않는다 — 이 판정을 여기 한 곳(SSOT)에 둔다.
//
// 순수함수(무의존)라 실행 러너 없이 node --experimental-strip-types 로 진리표를 회귀 테스트한다.
//   scripts/qa-session-readfail.mjs (npm run qa:session)

export type ReadFailAction = 'keep' | 'reset';

/**
 * 읽기 실패가 났을 때 세션을 어떻게 할지 결정한다.
 * - 'keep':  이미 확립된 '같은 사용자' 세션 → 일시적 실패이므로 상태 보존(다음 폴링/재시도로 복구). 무음 강등 차단.
 * - 'reset': 그 외(콜드 로드·다른 사용자·미확립) → 신원을 확정할 수 없으므로 가짜 테넌트 대신 깨끗한 signed_out.
 */
export function sessionReadFailAction(
  prior: { status: string; userId: string },
  loadingUserId: string,
): ReadFailAction {
  if (prior.status === 'signed_in' && !!loadingUserId && prior.userId === loadingUserId) return 'keep';
  return 'reset';
}
