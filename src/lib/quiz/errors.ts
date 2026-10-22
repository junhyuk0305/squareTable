// errors.ts — 퀴즈 서버 raise exception 코드 → 사람 말. 모양은 src/lib/brand/errors.ts 와 같다.
// 새 raise 코드를 만들면 같은 커밋에서 여기에 문구를 넣는다(AGENTS ⑨). 모르는 코드는 fallback 으로 떨어진다.
// ⚠️ 하니스(qa-quiz-contract)가 이 파일을 단독으로 컴파일한다. 경로 별칭(@/) import 를 넣지 않는다.
type QuizErr = { message?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  // 0326·0327 문항 0개 금지
  last_quiz_item: '마지막 문항은 뺄 수 없어요. 퀴즈를 그만 내려면 퀴즈를 보관해 주세요.',
  quiz_no_items: '문항이 없는 퀴즈는 보낼 수 없어요. 문항을 하나 이상 만들어 주세요.',
};

/**
 * 링크 제출 결과(N19). quiz_link_submit(_v2) 의 raise 코드를 손님이 할 수 있는 일로 나눈다.
 * link_closed·rate_limited 는 다시 보내도 안 된다. network 만 "다시 보내 주세요"다.
 */
export type LinkSubmitResult = 'ok' | 'link_closed' | 'rate_limited' | 'bad_input' | 'network';

const LINK_SUBMIT_CODE: Record<string, LinkSubmitResult> = {
  link_unavailable: 'link_closed',
  too_many_submissions: 'rate_limited',
  bad_phone: 'bad_input',
  name_required: 'bad_input',
  bad_answers: 'bad_input',
  too_many_rows: 'bad_input',
};

export function linkSubmitResultOf(err: QuizErr): LinkSubmitResult {
  if (!err) return 'ok';
  const code = (err.message ?? '').split(/[\s:]/)[0];
  return LINK_SUBMIT_CODE[code] ?? 'network';
}

export const LINK_SUBMIT_MESSAGE: Record<LinkSubmitResult, string> = {
  ok: '결과는 사장님께 전달됐어요. 이 창은 닫으셔도 돼요.',
  link_closed: '이 링크는 닫혔어요. 사장님께 새 링크를 받아 주세요.',
  rate_limited: '이 링크로 낼 수 있는 횟수를 넘었어요. 사장님께 알려 주세요.',
  bad_input: '이름이나 전화번호를 다시 확인해 주세요.',
  network: '결과를 보내지 못했어요. 답은 그대로 있으니 다시 보내 주세요.',
};

export function quizErrorMessage(err: QuizErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const code = (err?.message ?? '').split(/[\s:]/)[0];
  return MESSAGES[code] ?? fallback;
}
