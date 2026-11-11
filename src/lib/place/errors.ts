// errors.ts — 공간·교육 링크 RPC 의 raise exception 코드 → 사람 말. 모양은 src/lib/brand/errors.ts 와 같다.
//   2026-11-11 통합 라이브 적용: edu/errors.ts(교육 링크 0400)·space/errors.ts(공간 삭제 0430 · 멤버 0460)를 여기로 합쳤다.
// 정본 = 산출물/공간매장통합_2026-11-10/알림사건_오류코드_2026-11-10.md 4-2·4-3.
// ★새 코드는 이 파일 한 곳에만 문구를 둔다. 모르는 코드는 일반 문구로 떨어진다(내부 값을 화면에 안 낸다 · AGENTS ⑨).
//   원문은 console 로만 남긴다. 연결·로그인 같은 횡단 오류는 friendlyError(COMMON) 가 먼저 본다.
import type { DbErr } from '@/lib/db';
import { friendlyError } from '@/lib/utils/userError';
import { SPACE_WORDS } from './words';

const MESSAGES: Record<string, string> = {
  // ── 입구 · 만들기(0368 · 0374 · 0375) ──
  // space_closed · invite_code_busy · no_session 은 userError.ts COMMON 에 이미 문구가 있다 → friendlyError 로 간다(같은 코드에 문구 두 벌 금지).
  // 순서는 같은 끝맺음이 셋 이어지지 않게 섞었다(npm run voice S6).
  space_name_required: '공간 이름을 적어 주세요.',
  owner_cannot_create_space: '사장님 계정으로는 공간을 만들 수 없어요.',
  space_limit_reached: '공간은 1개까지 만들 수 있어요.',
  not_a_member: '이 공간의 멤버가 아니에요. 공간 주인에게 초대코드를 받아 주세요.',
  // 공간 만들기(0375)와 공간 합류·멤버 요청(0460)이 같이 쓴다.
  PHONE_NOT_VERIFIED: '전화번호 인증이 필요해요. 인증을 마치면 이어서 할 수 있어요.',
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
  // ── 노하우 지우기(0376 archive_knowhow) ── entry_not_found 는 아래 5번 묶음 문구를 같이 쓴다.
  restore_not_allowed: '지운 노하우는 되살릴 수 없어요.',
  not_owner: '노하우를 지울 수 있는 사람만 할 수 있어요.',
  // ── 매장과 연결하기(0490 · 5번 덩이) ──
  // feature_off · not_space_owner · suggestion_not_found · invalid_argument · not_manager 는 위 문구를 같이 쓴다.
  not_store_member: '매장에 합류하면 여기서 노하우를 보낼 수 있어요.',
  store_not_accepting: '지금은 이 매장에 보낼 수 없어요.',
  no_entries: '보낼 노하우를 하나 이상 골라 주세요.',
  entry_not_found: '노하우를 찾을 수 없어요. 화면을 새로고침해 주세요.',
  already_proposed: '이미 보낸 노하우예요. 사장님 승인을 기다리고 있어요.',
  suggestion_not_pending: '이미 처리한 제안이에요.',
  too_many_entries: '한 번에 50개까지 보낼 수 있어요.',
  too_many_pending: '사장님이 볼 노하우가 50개 쌓였어요. 사장님이 확인한 뒤 다시 보내 주세요.',
  not_authenticated: '다시 로그인해 주세요.',
  // ── 교육 링크(0400) ── not_space_owner · not_manager · invalid_argument 는 위 문구를 같이 쓴다.
  //   EDU_LINK_ENTRY_DENIED 처럼 userError.ts 에 있는 코드는 그쪽 문구를 쓴다.
  link_closed: SPACE_WORDS.linkClosed,
  link_expired: '기간이 끝난 링크예요. 새 링크를 만들어 주세요.',
  link_not_found: '링크를 찾을 수 없어요. 화면을 새로고침해 주세요.',
  // ── 공간 삭제 · 공간 주인 탈퇴(0430) ──
  space_has_members: '공간에 멤버가 남아 있어요. 공간을 먼저 지우면 탈퇴할 수 있어요.',
  // ── 합류 · 멤버 요청 · 내보내기 · 나가기(0460) ── not_space_member · feature_off · PHONE_NOT_VERIFIED 는 위 문구를 같이 쓴다.
  space_not_accepting: '지금은 이 공간에 들어갈 수 없어요. 공간 주인에게 알려 주세요.',
  already_member: '이미 이 공간의 멤버예요.',
  already_pending: '이미 합류를 신청했어요. 공간 주인의 승인을 기다리고 있어요.',
  request_not_pending: '이미 처리한 요청이에요.',
  too_many_attempts: '여러 번 틀렸어요. 잠시 뒤 다시 시도해 주세요.',
  request_cooldown: '방금 처리된 요청이에요. 30분 뒤에 다시 신청할 수 있어요.',
  space_owner_cannot_leave: '공간 주인은 나갈 수 없어요. 공간을 지우면 멤버도 함께 나가요.',
  // ── 교육 링크 묻기·보내기·신고(0401) ── link_closed · invalid_argument · question_not_found 는 위 문구를 같이 쓴다.
  name_required: '이름을 적어 주세요.',
  too_many_questions: '질문이 한꺼번에 많이 왔어요. 잠시 뒤 다시 물어봐 주세요.',
  rate_limited: '신고는 하루에 5건까지 보낼 수 있어요.',
  invalid_category: '어떤 문제인지 골라 주세요.',
  invalid_body: '내용을 5자 이상 적어 주세요.',
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

// night-1111 s1
// 멤버 묻기(0551) · 이어받기(0552). MESSAGES 표는 위에 있다. 두 서버 줄이 이 파일 끝에 덧붙이므로 합칠 때 둘 다 살린다.
Object.assign(MESSAGES, {
  practice_only: '공간 주인의 질문은 연습이라 저장하지 않아요.',
  handoff_busy: '잠시 뒤 다시 눌러 주세요.',
} satisfies Record<string, string>);
