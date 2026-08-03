// t6 이름 · 게임형 — ㅂㄱㅍㄹㅅ → 백플러시. 07-29 §03 T6 ★★ 10초.
//
// 07-29 판단: 이미 다들 아는 놀이라 설명이 0줄이고 한 판이 10초다. 한국어라서 되는 형태.
// 난이도 3단은 선택지를 3개 → 5개로 늘려서 만든다(§04 규칙 5) → 선택지 상한 5.
// chosung 은 문제의 일부라 응시 화면에도 그대로 보인다(stripKeys 대상 아님).

import { STR, choicePickSpec } from './spec';

export const chosung = choicePickSpec({
  key: 'chosung',
  kind: 't6',
  label: '초성',
  seconds: 10,
  maxChoices: 5,
  extraSchema: { chosung: STR },
  extraRequired: ['chosung'],
  validateExtra: (payload) => (String(payload?.chosung ?? '').trim() ? null : '초성을 적어 주세요.'),
  aiHint:
    '매장 용어의 초성만 보여주고 맞히는 문제다. chosung 에는 정답 용어의 초성을 띄어서 적고'
    + '(예: 백플러시 → "ㅂ ㅍ ㄹ ㅅ"), ask 에는 그 용어가 무엇인지 한 줄 설명을 쓴다. '
    + '선택지는 3~5개이고 정답은 노하우에 실제로 나오는 용어여야 한다. '
    + '일반 명사는 출제하지 마라.',
});
