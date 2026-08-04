// t3 금지 · 게임형 — 행동 카드가 하나씩 지나가고 금지 행동일 때만 탭. 07-29 §03 T3 ★★ 30초.
//
// 07-29 판단: 안 누르는 것도 답이다. 4지선다는 찍으면 25%가 맞지만 이건 카드마다 누를지 말지를
// 정해야 해서 반사적으로 풀 수 없다. 여러 노하우를 섞어 한 판을 만든다(묶음형).
// 응답(QuizResponse) = 탭한 카드 index 배열.
//
// 특수 처리: stripKeys 로는 못 지우는 cards[].is_mine 을 서버가 카드마다 제거한다.
//           ★ 서버 0107 quiz_items_for 도 같은 처리를 해야 한다.

import type { FormatSpec } from './spec';
import { INT, STR } from './spec';

const MIN_CARDS = 4;
const MAX_CARDS = 8;

export const mineTap: FormatSpec = {
  key: 'mine_tap',
  kind: 't3',
  label: '지뢰 밟기',
  seconds: 30,
  bundled: true,
  // 서버 0107 quiz_items_for 와 동일해야 함 (+ cards[].is_mine 제거)
  stripKeys: ['explain'],
  grade: (payload, res) => {
    const cards = payload?.cards;
    if (!Array.isArray(cards) || !Array.isArray(res)) return false;
    const tapped = new Set((res as number[]).filter((n) => Number.isInteger(n)));
    return cards.every((c: any, i: number) => tapped.has(i) === (c?.is_mine === true));
  },
  validate: (payload) => {
    if (!String(payload?.ask ?? '').trim()) return '질문을 적어 주세요.';
    const cards = payload?.cards;
    if (!Array.isArray(cards) || cards.length < MIN_CARDS) return `카드는 ${MIN_CARDS}개 이상이어야 해요.`;
    if (cards.length > MAX_CARDS) return `카드는 ${MAX_CARDS}개까지 넣을 수 있어요.`;
    if (cards.some((c: any) => !String(c?.text ?? '').trim())) return '카드 내용을 모두 채워 주세요.';
    const mines = cards.filter((c: any) => c?.is_mine === true).length;
    if (mines === 0) return '하면 안 되는 카드를 1개 이상 골라 주세요.';
    if (mines === cards.length) return '괜찮은 카드도 1개 이상 있어야 해요.';
    return null;
  },
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: STR, is_mine: { type: 'boolean' } },
          required: ['text', 'is_mine'],
        },
        maxItems: MAX_CARDS,
      },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'cards'],
  },
  aiHint:
    '카드가 하나씩 지나가고 하면 안 되는 행동일 때만 탭하는 문제다. '
    + 'is_mine=true 카드는 노하우의 금지를 한 줄 행동으로 쓴 것, false 카드는 같은 노하우의 정상 행동이다. '
    + `카드는 ${MIN_CARDS}~${MAX_CARDS}장이고 금지와 정상이 각각 1장 이상 있어야 한다. `
    + '상식적으로는 합리적으로 보이는 문장이어야 골라내는 연습이 된다.',
};
