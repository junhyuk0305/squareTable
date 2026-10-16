// decision.ts — 결정 뮤테이션(승인·거절·완료 해제·교대…)의 결과 분류 SSOT(P2 ⑦).
//
// 모든 쓰기 결과는 네 갈래 중 하나다. 화면·스토어는 이 네 갈래로만 분기한다(기능마다 정규식 금지).
//  ok      = 서버가 바꿨다.
//  already = 이미 그 상태다(다른 기기에서 먼저 처리 · 0행). 오류가 아니다 → 오류 문구 없이 hydrate + 중립 한 줄.
//  blocked = 전제가 안 맞아 서버가 거부했다(한도 · 기간 · 상태). 사실만 말한다(BLOCKED_TEXT).
//  failed  = 그 밖의 실패(권한 · 연결 · 모르는 코드). "못 했어요" + reportError.
//
// 서버 예외 이름(raise exception '<코드>')의 분류표. 표에 없는 이름 = failed.
// not_owner · owner_only 같은 권한 코드는 failed 다 — 그 버튼이 보였다면 세션이 낡았거나 버그라, 사용자가 고칠 전제가 없다.
export type Decision = 'ok' | 'already' | 'blocked' | 'failed';

const ALREADY_CODES = [
  'not_pending',           // approve_member · reject_member · decide_shift_time · 합류 신청 결정
  'already_pending',       // join_by_invite(0266)
  'already_member',        // join_by_invite(0067 · 0266)
  'already_in_store',
  'swap_already_decided',  // swap_requests 트리거(0258)
  'swap_cancel_status_only', // 취소는 status 만(0293) — 다른 칸이 바뀌었다 = 그 사이 남이 처리했다
] as const;

const BLOCKED_CODES = [
  'staff_limit',             // 무료 플랜 좌석 캡(0062 · 0273)
  'too_many_attempts',       // 초대코드 시도 잠금(0266)
  'store_not_accepting',     // 닫힌 매장(0266)
  'owner_cannot_join',       // 사장 계정은 직원 합류 불가(0266)
  'too_many_pending',        // 미해결 질문 상한(0033)
  'swap_target_unavailable', // 맞교환 상대 근무가 사라짐(0289)
  'confirm_past_required',   // 지난 날짜는 확인창을 거쳐야(0242 · 0289)
  'too_old',                 // 35일 지난 근무(0289)
  'edit_window_passed',      // 수정 가능 시간 지남(0252)
  'swap_update_not_allowed', // 교대 행은 RPC 로만(0295)
  'past_month_locked',       // 지난달 근무 잠금(0266)
  'ai_quota_exceeded',       // 엣지 ai 402
  'rate_limited',            // 엣지 ai 429
] as const;

/** blocked 코드 → 사람 말(AGENTS ⑨: 코드→문구는 한 곳). 모르는 코드는 호출부 폴백. */
export const BLOCKED_TEXT: Partial<Record<(typeof BLOCKED_CODES)[number], string>> = {
  too_many_pending: '대기 중인 질문이 많아요. 사장님 답변을 받은 뒤 다시 등록해 주세요.',
  too_old: '35일이 지난 요청은 반려만 할 수 있어요.',
  swap_target_unavailable: '맞교환 상대 근무가 바뀌어 승인할 수 없어요.',
  confirm_past_required: '지난 근무는 확인을 거쳐야 승인할 수 있어요.',
  edit_window_passed: '수정할 수 있는 시간이 지났어요.',
  swap_update_not_allowed: '이 요청은 여기서 바꿀 수 없어요.',
};

/** 오류 원문에서 분류표에 있는 코드를 찾는다. 없으면 null. */
export function codeOf(message: string | null | undefined): string | null {
  if (!message) return null;
  for (const c of ALREADY_CODES) if (message.includes(c)) return c;
  for (const c of BLOCKED_CODES) if (message.includes(c)) return c;
  return null;
}

/** 서버 오류 → 갈래. 호출부는 코드가 필요하면 codeOf 를 같이 쓴다. */
export function decisionOfError(message: string | null | undefined): Exclude<Decision, 'ok'> {
  const c = codeOf(message);
  if (!c) return 'failed';
  return (ALREADY_CODES as readonly string[]).includes(c) ? 'already' : 'blocked';
}

export function blockedText(code: string | null, fallback: string): string {
  return (code && (BLOCKED_TEXT as Record<string, string>)[code]) || fallback;
}
