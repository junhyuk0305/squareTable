// errors.ts — 공간(2번 덩이) RPC 의 raise exception 코드 → 사람 말. 모양은 src/lib/brand/errors.ts 와 같다.
// 정본 = 산출물/공간매장통합_2026-11-10/알림사건_오류코드_2026-11-10.md 4-2·4-3.
// ★새 코드는 이 파일 한 곳에만 문구를 둔다. 모르는 코드는 일반 문구로 떨어진다(내부 값을 화면에 안 낸다 · AGENTS ⑨).
//   원문은 console 로만 남긴다. 연결·로그인 같은 횡단 오류는 friendlyError(COMMON) 가 먼저 본다.
import type { DbErr } from '@/lib/db';
import { friendlyError } from '@/lib/utils/userError';

const MESSAGES: Record<string, string> = {
  // ── 입구 · 만들기(0368 · 0374 · 0375) ──
  // space_closed · invite_code_busy · no_session 은 userError.ts COMMON 에 이미 문구가 있다 → friendlyError 로 간다(같은 코드에 문구 두 벌 금지).
  // 순서는 같은 끝맺음이 셋 이어지지 않게 섞었다(npm run voice S6).
  space_name_required: '공간 이름을 적어 주세요.',
  owner_cannot_create_space: '사장님 계정으로는 공간을 만들 수 없어요.',
  space_limit_reached: '공간은 1개까지 만들 수 있어요.',
  not_a_member: '이 공간의 멤버가 아니에요. 공간 주인에게 초대코드를 받아 주세요.',
  PHONE_NOT_VERIFIED: '전화번호 인증이 필요해요. 아래에서 인증을 마치면 공간을 만들 수 있어요.',
  not_space_member: '이 공간의 멤버가 아니에요. 공간 주인에게 초대코드를 받아 주세요.',
  not_space_owner: '공간 주인만 할 수 있어요.',
  // ── 답하기(0378 · 0379) ──
  feature_off: '여기서는 쓸 수 없는 기능이에요. 화면을 새로고침해 주세요.',
  question_not_found: '질문을 찾을 수 없어요. 화면을 새로고침해 주세요.',
  not_pending: '이미 답한 질문이에요.',
  suggestion_not_found: '제안을 찾을 수 없어요. 화면을 새로고침해 주세요.',
  invalid_argument: '빈 칸이 있어요. 다시 적어 주세요.',
  not_manager: '사장님이나 매니저만 할 수 있어요.',
  forbidden: '지금 있는 곳의 정보만 볼 수 있어요. 화면을 새로고침해 주세요.',
  // ── 매장과 연결하기(0490 · 5번 덩이) ──
  // feature_off · not_space_owner · suggestion_not_found · invalid_argument · not_manager 는 위 문구를 같이 쓴다.
  not_store_member: '매장에 합류하면 여기서 노하우를 보낼 수 있어요.',
  store_not_accepting: '지금은 이 매장에 보낼 수 없어요.',
  no_entries: '보낼 노하우를 하나 이상 골라 주세요.',
  entry_not_found: '노하우를 찾을 수 없어요. 화면을 새로고침해 주세요.',
  already_proposed: '이미 보낸 노하우예요. 사장님 승인을 기다리고 있어요.',
  suggestion_not_pending: '이미 처리한 제안이에요.',
  too_many_entries: '한 번에 50개까지 보낼 수 있어요.',
  not_authenticated: '다시 로그인해 주세요.',
};

const FALLBACK = '잠시 뒤 다시 시도해 주세요.';

/** 오류 → 화면 문구. 코드 = 원문의 첫 낱말(brand/errors.ts 와 같은 규칙). */
export function placeErrorMessage(err: DbErr | string | null | undefined, fallback = FALLBACK): string {
  const raw = typeof err === 'string' ? err : err?.message ?? '';
  const code = raw.split(/[\s:]/)[0];
  if (MESSAGES[code]) return MESSAGES[code];
  // 연결·시간 초과·로그인 만료는 공통 문구가 맞다. 그 밖의 모르는 원문은 fallback 으로 떨어진다.
  return friendlyError(raw || null, fallback);
}

/** 오류 코드(첫 낱말). 화면이 갈래를 나눠야 할 때만 쓴다(예: PHONE_NOT_VERIFIED → 인증 단계 열기). */
export function placeErrorCode(err: DbErr | null | undefined): string | null {
  const code = (err?.message ?? '').split(/[\s:]/)[0];
  return code || null;
}
