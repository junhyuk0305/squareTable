// t2 수치 · 게임형 — 탭할 때마다 하나씩 채우고, 정해진 횟수에서 멈춘다. 07-29 §03 T2 ★★ 10초.
//
// 07-29 판단: 슬라이더는 답을 가리키는 동작이지만 탭으로 채우는 건 실제 행동과 같은 동작이다.
// 멈춰야 할 때 멈추는 것도 과제에 포함되므로, 한 번 더 누르면 그 자리에서 틀린다.
// 응답(QuizResponse) = 누른 횟수.

import type { FormatSpec } from './spec';
import { INT, STR } from './spec';

/**
 * 한 판 10초 안에 눌러야 하므로 상한을 둔다(07-29 §04 규칙 2).
 * ★이 값이 곧 **fill_count 와 numeric_entry 의 경계**다 — 여기까지는 탭으로 올리고(손이 기억한다),
 *   넘으면 텐키로 친다. generate.ts 의 numeric_entry 재료 게이트가 이 상수를 가져다 쓴다.
 */
export const MAX_TARGET = 12;

export const fillCount: FormatSpec = {
  key: 'fill_count',
  kind: 't2',
  label: '채워 넣기',
  seconds: 10,
  // 서버 0107 quiz_items_for 와 동일해야 함
  stripKeys: ['target', 'explain'],
  grade: (payload, res) => typeof res === 'number' && res === payload?.target,
  validate: (payload) => {
    if (!String(payload?.ask ?? '').trim()) return '질문을 적어 주세요.';
    if (!String(payload?.unit ?? '').trim()) return '단위를 적어 주세요.';
    const t = payload?.target;
    if (!Number.isInteger(t) || t < 1 || t > MAX_TARGET) return `몇 번인지 1에서 ${MAX_TARGET} 사이로 적어 주세요.`;
    return null;
  },
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      target: INT,
      unit: STR,
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'target', 'unit'],
  },
  aiHint:
    '탭할 때마다 하나씩 채우는 문제다. target 은 노하우에 적힌 횟수·개수 그대로(1~12 정수), '
    + 'unit 은 그 단위(펌프·샷·번·장 등)다. ask 는 무엇을 얼마나 넣는지 한 줄로 쓴다. '
    + '노하우에 개수가 적혀 있지 않으면 출제하지 마라.',
};
