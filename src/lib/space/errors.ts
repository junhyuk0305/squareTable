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
};

export function spaceErrorMessage(err: SpaceErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const raw = err?.message ?? '';
  const code = raw.split(/[\s:]/)[0];
  return MESSAGES[code] ?? friendlyError(raw, fallback);
}
