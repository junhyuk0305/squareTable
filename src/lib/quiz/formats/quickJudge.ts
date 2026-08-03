// t5 갈래 · 게임형 — 카드가 하나씩 뜨고 두 버튼 중 하나를 제한 시간 안에. 07-29 §03 T5 ★★ 30초.
//
// 07-29 판단: 이 유형은 현장에서 실제로 3초 안에 판단해야 하는 지식이라 시간 제한이 억지가 아니다.
// 난이도는 문항 수가 아니라 초를 줄여서 올린다(3.0 → 2.5 → 2.0, §04 규칙 5).
// 응답(QuizResponse) = 카드별 선택 배열(labels 의 index).
//
// 특수 처리: stripKeys 로는 못 지우는 cards[].answer 를 서버가 카드마다 제거한다.
//           ★ 서버 0107 quiz_items_for 도 같은 처리를 해야 한다.

import type { FormatSpec } from './spec';
import { INT, STR, checkTexts, strArray } from './spec';

const MIN_CARDS = 4;
const MAX_CARDS = 8;
/** 카드 1장당 제한 시간(초). 07-29 난이도 표의 3.0 → 2.5 → 2.0 범위. */
const MIN_SECONDS = 2;
const MAX_SECONDS = 5;

export const quickJudge: FormatSpec = {
  key: 'quick_judge',
  kind: 't5',
  label: '빠른 판별',
  seconds: 30,
  bundled: true,
  // 서버 0107 quiz_items_for 와 동일해야 함 (+ cards[].answer 제거)
  stripKeys: ['explain'],
  grade: (payload, res) => {
    const cards = payload?.cards;
    if (!Array.isArray(cards) || !Array.isArray(res)) return false;
    if (res.length !== cards.length) return false;
    return cards.every((c: any, i: number) => (res as number[])[i] === c?.answer);
  },
  validate: (payload) => {
    if (!String(payload?.ask ?? '').trim()) return '질문을 적어 주세요.';
    const labelErr = checkTexts(payload?.labels, 2, 2, '버튼 이름');
    if (labelErr) return labelErr;
    const cards = payload?.cards;
    if (!Array.isArray(cards) || cards.length < MIN_CARDS) return `카드는 ${MIN_CARDS}개 이상이어야 해요.`;
    if (cards.length > MAX_CARDS) return `카드는 ${MAX_CARDS}개까지 넣을 수 있어요.`;
    if (cards.some((c: any) => !String(c?.text ?? '').trim())) return '카드 내용을 모두 채워 주세요.';
    if (cards.some((c: any) => c?.answer !== 0 && c?.answer !== 1)) return '카드마다 답을 골라 주세요.';
    if (new Set(cards.map((c: any) => c.answer)).size < 2) return '두 버튼의 답이 각각 1장 이상 있어야 해요.';
    const s = payload?.seconds;
    if (!Number.isInteger(s) || s < MIN_SECONDS || s > MAX_SECONDS) {
      return `카드마다 주는 시간을 ${MIN_SECONDS}에서 ${MAX_SECONDS}초 사이로 정해 주세요.`;
    }
    return null;
  },
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      labels: strArray(2),
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: STR, answer: INT },
          required: ['text', 'answer'],
        },
        maxItems: MAX_CARDS,
      },
      seconds: INT,
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'labels', 'cards', 'seconds'],
  },
  aiHint:
    '카드 하나마다 두 버튼 중 하나를 고르는 문제다. labels 는 두 버튼 이름(예: ["쓴다","버린다"])이고, '
    + `cards[].answer 는 그 카드의 정답 버튼 위치(0 또는 1)다. 카드는 ${MIN_CARDS}~${MAX_CARDS}장, `
    + `seconds 는 카드 1장당 주는 시간(${MIN_SECONDS}~${MAX_SECONDS} 정수, 기본 3)이다. `
    + '두 버튼의 답이 각각 1장 이상 나와야 하고, 카드 내용은 노하우의 조건·사례에서만 뽑는다.',
};
