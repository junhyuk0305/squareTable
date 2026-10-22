// errors.ts — 퀴즈 서버 raise exception 코드 → 사람 말. 모양은 src/lib/brand/errors.ts 와 같다.
// 새 raise 코드를 만들면 같은 커밋에서 여기에 문구를 넣는다(AGENTS ⑨). 모르는 코드는 fallback 으로 떨어진다.
// ⚠️ 하니스(qa-quiz-contract)가 이 파일을 단독으로 컴파일한다. 경로 별칭(@/) import 를 넣지 않는다.
type QuizErr = { message?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  // 0326·0327 문항 0개 금지
  last_quiz_item: '마지막 문항은 뺄 수 없어요. 퀴즈를 그만 내려면 퀴즈를 보관해 주세요.',
  quiz_no_items: '문항이 없는 퀴즈는 보낼 수 없어요. 문항을 하나 이상 만들어 주세요.',
};

export function quizErrorMessage(err: QuizErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const code = (err?.message ?? '').split(/[\s:]/)[0];
  return MESSAGES[code] ?? fallback;
}
