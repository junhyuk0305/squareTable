// t1 순서 · 일반형 — 순서 조합 4개 중 맞는 것. 07-29 §03 T1 "순서 고르기" 12초.
// 선택지 각 항목은 단계를 " → " 로 이은 한 줄이다.

import { choicePickSpec } from './spec';

export const orderPick = choicePickSpec({
  key: 'order_pick',
  kind: 't1',
  label: '순서 고르기',
  seconds: 12,
  aiHint:
    '노하우의 단계(steps)만 써서 순서 조합 3~4개를 만들어라. 각 선택지는 단계를 " → " 로 이은 한 줄이다. '
    + '정답은 실제 순서 하나뿐이고, 오답은 두 단계의 자리를 맞바꾼 것으로 만들어라. '
    + '단계를 새로 지어내거나 빼지 마라. 순서가 중요하지 않은 나열이면 출제하지 마라.',
});
