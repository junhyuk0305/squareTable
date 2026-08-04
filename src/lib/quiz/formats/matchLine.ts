// t4 짝 · 게임형 — 좌우 두 줄을 잇는다. 왼쪽 탭 → 오른쪽 탭으로 한 쌍. 07-29 §03 T4 ★ 35초.
//
// ⚠️ 35초는 07-29 §04 규칙 2("한 판 30초")를 5초 넘긴다. 07-29 §03 표에 35초로 적혀 있어
//    문서 값을 그대로 둔다 — 줄이려면 쌍 수(3~5)를 줄이는 쪽이지 시간을 깎는 쪽이 아니다.
//
// 응답(QuizResponse) = Record<왼쪽 index, 오른쪽 index>.
// ★ 오른쪽 index 는 "응시 화면에 보인 rights 배열" 기준이다.
//
// 특수 처리: 서버가 pairs 를 lefts[]·rights[] 로 분해하고 rights 를 결정적으로 섞어서 내려준다
//           (item.id 해시 기준 — 매번 같은 배치라야 채점이 결정적이다).
//           ★ 서버 0107 quiz_items_for 도 같은 처리를 해야 한다.
//           아래 grade() 는 index 가 아니라 "오른쪽 텍스트"로 비교하므로 섞임 방식과 무관하게 맞는다.

import type { FormatSpec } from './spec';
import { INT, STR } from './spec';

const MIN_PAIRS = 3;
const MAX_PAIRS = 5;

export const matchLine: FormatSpec = {
  key: 'match_line',
  kind: 't4',
  label: '줄 잇기',
  seconds: 35,
  bundled: true,
  // 서버 0107 quiz_items_for 와 동일해야 함 (+ pairs → lefts[]/rights[] 분해)
  stripKeys: ['explain'],
  grade: (payload, res) => {
    const pairs = payload?.pairs;
    if (!Array.isArray(pairs) || pairs.length === 0) return false;
    if (typeof res !== 'object' || res === null || Array.isArray(res)) return false;
    // 응시본을 그대로 들고 있으면 그 rights 배열을, 원본만 있으면 pairs 순서를 쓴다.
    const rights: string[] = Array.isArray(payload?.rights)
      ? payload.rights.map((r: any) => String(r))
      : pairs.map((p: any) => String(p?.right ?? ''));
    const map = res as Record<number, number>;
    return pairs.every((p: any, i: number) => rights[map[i]] === String(p?.right ?? ''));
  },
  validate: (payload) => {
    if (!String(payload?.ask ?? '').trim()) return '질문을 적어 주세요.';
    const pairs = payload?.pairs;
    if (!Array.isArray(pairs) || pairs.length < MIN_PAIRS) return `짝은 ${MIN_PAIRS}쌍 이상이어야 해요.`;
    if (pairs.length > MAX_PAIRS) return `짝은 ${MAX_PAIRS}쌍까지 넣을 수 있어요.`;
    if (pairs.some((p: any) => !String(p?.left ?? '').trim() || !String(p?.right ?? '').trim())) {
      return '빈 칸 없이 좌우를 모두 적어 주세요.';
    }
    // 오른쪽이 겹치면 어느 줄로 이어도 맞는 게 되어 채점이 모호해진다.
    if (new Set(pairs.map((p: any) => String(p.right).trim())).size !== pairs.length) {
      return '오른쪽 항목이 서로 달라야 해요.';
    }
    return null;
  },
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: { left: STR, right: STR },
          required: ['left', 'right'],
        },
        maxItems: MAX_PAIRS,
      },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'pairs'],
  },
  aiHint:
    `좌우를 잇는 문제다. 노하우에 실제로 붙어 있는 대응(상황↔말·물건↔자리·메뉴↔재료)만 ${MIN_PAIRS}~${MAX_PAIRS}쌍 뽑아라. `
    + '오른쪽 값이 서로 겹치면 안 된다. 짝이 3쌍도 안 나오면 출제하지 마라.',
};
