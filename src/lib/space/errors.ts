// errors.ts — 공간 삭제·공간 주인 탈퇴(0430) 서버 raise exception 코드 → 사람 말. 모양은 src/lib/quiz/errors.ts 와 같다.
// ⚠️ 정본 위치는 src/lib/place/errors.ts 다(2번 덩이). 그 파일이 생기면 여기 코드를 그쪽으로 합친다.
// 새 raise 코드를 만들면 같은 커밋에서 여기에 문구를 넣는다(AGENTS ⑨). 모르는 코드는 friendlyError 를 거쳐 fallback 으로 떨어진다.
import { friendlyError } from '@/lib/utils/userError';

type SpaceErr = { message?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  // delete_space: 남의 공간 · 없는 번호 · 이미 지운 공간
  not_space_owner: '공간 주인만 할 수 있어요.',
  // delete_my_account: 살아 있는 멤버가 있는 공간의 주인
  space_has_members: '공간에 멤버가 남아 있어요. 공간을 먼저 지우면 탈퇴할 수 있어요.',
  // ── 합류 · 멤버 요청 · 내보내기 · 나가기(0460) ──
  // space_closed 는 userError.ts COMMON 에 문구가 있다. link_closed 는 edu/errors.ts(링크 화면)의 문구를 쓴다.
  // 순서는 같은 끝맺음이 셋 이어지지 않게 섞었다.
  space_not_accepting: '지금은 이 공간에 들어갈 수 없어요. 공간 주인에게 알려 주세요.',
  already_member: '이미 이 공간의 멤버예요.',
  already_pending: '이미 합류를 신청했어요. 공간 주인의 승인을 기다리고 있어요.',
  request_not_pending: '이미 처리한 요청이에요.',
  too_many_attempts: '여러 번 틀렸어요. 잠시 뒤 다시 시도해 주세요.',
  request_cooldown: '방금 처리된 요청이에요. 10분 뒤에 다시 신청할 수 있어요.',
  PHONE_NOT_VERIFIED: '전화번호 인증이 필요해요. 인증을 마치면 공간에 들어갈 수 있어요.',
  not_space_member: '이 공간의 멤버가 아니에요. 공간 주인에게 초대코드를 받아 주세요.',
  space_owner_cannot_leave: '공간 주인은 나갈 수 없어요. 공간을 지우면 멤버도 함께 나가요.',
  feature_off: '여기서는 쓸 수 없는 기능이에요. 화면을 새로고침해 주세요.',
};

export function spaceErrorMessage(err: SpaceErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const raw = err?.message ?? '';
  const code = raw.split(/[\s:]/)[0];
  return MESSAGES[code] ?? friendlyError(raw, fallback);
}
