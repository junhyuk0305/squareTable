// errors.ts — 제안 취소·수정 RPC(0355 suggestion_withdraw·suggestion_edit)의 raise 코드 → 사람 말.
// 모양은 src/lib/brand/errors.ts·src/lib/quiz/errors.ts 와 같다. 새 raise 코드는 같은 커밋에서 여기에 넣는다(AGENTS ⑨).
// 모르는 코드는 fallback 으로 떨어진다.
import type { DbErr } from '@/lib/db';

const MESSAGES: Record<string, string> = {
  not_found: '제안을 찾을 수 없어요. 화면을 새로고침해 주세요.',
  not_pending: '사장님이 이미 처리한 제안이에요. 이제 바꿀 수 없어요.',
  forbidden: '내가 보낸 제안만 바꿀 수 있어요.',
  invalid_argument: '제안 내용을 적어 주세요.',
};

export function suggestionErrorMessage(err: DbErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const code = (err?.message ?? '').split(/[\s:]/)[0];
  return MESSAGES[code] ?? fallback;
}
