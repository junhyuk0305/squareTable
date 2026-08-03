// t2 수치 · 일반형 — 숫자 4개 중 하나. 07-29 §03 T2 "값 고르기" 8초.
// unit 은 응시 화면에도 그대로 보인다(정답이 아니므로 stripKeys 대상이 아님).

import { STR, choicePickSpec } from './spec';

export const valuePick = choicePickSpec({
  key: 'value_pick',
  kind: 't2',
  label: '값 고르기',
  seconds: 8,
  extraSchema: { unit: STR },
  aiHint:
    '노하우에 적힌 수치 하나를 정답으로 두고, 헷갈릴 만한 값 3개를 오답으로 붙여라. '
    + 'unit 에는 그 단위(펌프·도·분·개 등)를 적는다. '
    + '노하우에 없는 수치를 새로 만들지 마라. 적힌 수치가 없으면 출제하지 마라.',
});
