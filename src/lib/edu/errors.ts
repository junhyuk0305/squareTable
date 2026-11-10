// errors.ts — 교육 링크 서버 raise exception 코드 → 사람 말. 모양은 src/lib/quiz/errors.ts 와 같다.
// 문구 출처 = 산출물/공간매장통합_2026-11-10/알림사건_오류코드_2026-11-10.md 4절.
// ⚠️ 정본 위치는 src/lib/place/errors.ts 다. 그 파일이 생기면 여기 코드를 그쪽으로 합친다.
// 새 raise 코드를 만들면 같은 커밋에서 여기에 문구를 넣는다(AGENTS ⑨). 모르는 코드는 friendlyError 를 거쳐 fallback 으로 떨어진다.
import { friendlyError } from '@/lib/utils/userError';
import { EDU_WORDS } from './words';

type EduErr = { message?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  link_closed: EDU_WORDS.linkClosed,
  link_expired: '기간이 끝난 링크예요. 새 링크를 만들어 주세요.',
  link_not_found: '링크를 찾을 수 없어요. 화면을 새로고침해 주세요.',
  not_space_owner: '공간 주인만 할 수 있어요.',
  not_manager: '사장님이나 매니저만 할 수 있어요.',
  invalid_argument: '빈 칸이 있어요. 다시 적어 주세요.',
};

/** EDU_LINK_ENTRY_DENIED 처럼 이미 userError.ts 에 있는 코드는 그쪽 문구를 쓴다(같은 코드에 문구 둘 금지). */
export function eduErrorMessage(err: EduErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const raw = err?.message ?? '';
  const code = raw.split(/[\s:]/)[0];
  return MESSAGES[code] ?? friendlyError(raw, fallback);
}
