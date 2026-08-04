// t1 순서 · 게임형 — 순서가 하나만 뒤바뀐 채로 보여주고 잘못 놓인 카드를 탭. 07-29 §03 T1 ★ 15초.
//
// 07-29 판단: 줄 세우기는 백지에서 만드는 과제고, 틀린 자리 찾기는 잘못된 걸 알아채는 과제다.
// 현장에서 실제로 필요한 건 후자라서 이쪽을 1차에 넣었다.

import type { FormatSpec } from './spec';
import { INT, STR, checkAsk, checkIndex, checkTexts, strArray } from './spec';

export const wrongSpot: FormatSpec = {
  key: 'wrong_spot',
  kind: 't1',
  label: '틀린 자리 찾기',
  seconds: 15,
  // 서버 0107 quiz_items_for 와 동일해야 함
  stripKeys: ['wrong_index', 'explain'],
  grade: (payload, res) => typeof res === 'number' && res === payload?.wrong_index,
  validate: (payload) =>
    checkAsk(payload)
    ?? checkTexts(payload?.sequence, 3, 6, '순서')
    ?? checkIndex(payload?.wrong_index, payload?.sequence?.length ?? 0, '잘못 놓인 자리를 골라 주세요.'),
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      sequence: strArray(6),
      wrong_index: INT,
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'sequence', 'wrong_index'],
  },
  aiHint:
    '노하우의 단계를 순서대로 늘어놓되 한 자리만 잘못된 위치로 옮겨라. '
    + 'sequence 는 그 잘못된 순서 그대로이고, wrong_index 는 잘못 놓인 항목의 위치(0부터)다. '
    + '단계는 3~6개, 노하우에 있는 것만 쓴다. 순서가 중요하지 않은 나열이면 출제하지 마라.',
};
