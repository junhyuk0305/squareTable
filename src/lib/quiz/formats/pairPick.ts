// t4 짝 · 일반형 — 왼쪽 하나를 주고 오른쪽 4개 중 고르기. 07-29 §03 T4 10초.
// left 는 응시 화면에도 그대로 보인다(문제의 일부라 stripKeys 대상이 아님).

import { STR, choicePickSpec } from './spec';

export const pairPick = choicePickSpec({
  key: 'pair_pick',
  kind: 't4',
  label: '짝 고르기',
  seconds: 10,
  extraSchema: { left: STR },
  extraRequired: ['left'],
  validateExtra: (payload) => (String(payload?.left ?? '').trim() ? null : '왼쪽 항목을 적어 주세요.'),
  aiHint:
    '왼쪽 항목 하나(left)를 주고 오른쪽 3~4개 중 맞는 짝을 고르는 문제다. '
    + '짝은 상황↔말(scripts)·물건↔자리처럼 노하우에 실제로 붙어 있는 대응만 쓴다. '
    + '오답 해설은 "틀렸어요"가 아니라 "이 매장은 이렇게 해요" 방향으로 쓴다.',
});
