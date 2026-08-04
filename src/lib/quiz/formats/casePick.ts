// t5 갈래 · 일반형 — 상황 한 줄 + 대응 4개. 07-29 §03 T5 15초.
// situation 은 응시 화면에도 그대로 보인다(문제의 일부라 stripKeys 대상이 아님).

import { STR, choicePickSpec } from './spec';

export const casePick = choicePickSpec({
  key: 'case_pick',
  kind: 't5',
  label: '상황 고르기',
  seconds: 15,
  extraSchema: { situation: STR },
  extraRequired: ['situation'],
  validateExtra: (payload) => (String(payload?.situation ?? '').trim() ? null : '상황을 적어 주세요.'),
  aiHint:
    '조건이 붙은 상황 한 줄(situation)을 주고 대응 3~4개 중 맞는 것을 고르는 문제다. '
    + '상황과 대응 모두 노하우에 적힌 조건·결과 그대로 쓴다. '
    + '오답은 다른 조건일 때의 대응으로 만들어야 갈래를 가르는 연습이 된다.',
});
