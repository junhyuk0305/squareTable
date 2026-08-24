// t2 수치 · 게임형 — 텐키로 값을 **직접 친다**. 08-24 UI 카탈로그 ⑬. 15초.
//
// fill_count(채워 넣기)와 나누는 기준은 **값의 크기**다.
//   · fill_count  : 1~12. 탭할 때마다 하나씩 올린다 — 실제 행동(펌프 3번)과 같은 동작이라 손이 기억한다.
//   · numeric_entry: 온도(62도)·시간(90분)처럼 탭으로 못 올리는 값. 보기가 없으니 찍기가 안 통한다.
// 그래서 상한을 999 로 둔다 — 매장 노하우의 값은 세 자리를 넘지 않고(온도·분·ml 전부),
// 자릿수를 열어 두면 화면의 텐키 표시가 깨진다.
//
// ★ 단위는 payload 에 남아 **화면에 표시만** 된다(응시자는 숫자만 친다). 정답 키가 아니라서
//   strip 대상이 아니다 — "몇 도인가"를 묻는데 단위를 감추면 문제 자체가 성립하지 않는다.
// 응답(QuizResponse) = 친 숫자.

import type { FormatSpec } from './spec';
import { INT, STR } from './spec';

/** 세 자리까지. 화면 텐키가 보여 줄 수 있는 칸 수이자 매장 값의 현실적인 상한이다. */
export const NUMERIC_MAX = 999;
const NUMERIC_MIN = 1;

export const numericEntry: FormatSpec = {
  key: 'numeric_entry',
  kind: 't2',
  label: '숫자로 답하기',
  seconds: 15,
  // 서버 0168 quiz_strip_payload 와 동일해야 함. unit 은 **일부러 남긴다**(위 주석).
  stripKeys: ['answer_value', 'explain'],
  grade: (payload, res) => typeof res === 'number' && res === payload?.answer_value,
  validate: (payload) => {
    if (!String(payload?.ask ?? '').trim()) return '질문을 적어 주세요.';
    if (!String(payload?.unit ?? '').trim()) return '단위를 적어 주세요.';
    const v = payload?.answer_value;
    if (!Number.isInteger(v) || v < NUMERIC_MIN || v > NUMERIC_MAX) {
      return `정답을 ${NUMERIC_MIN}에서 ${NUMERIC_MAX} 사이 숫자로 적어 주세요.`;
    }
    return null;
  },
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      answer_value: INT,
      unit: STR,
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'answer_value', 'unit'],
  },
  aiHint:
    '보기 없이 숫자만 직접 눌러 답하는 문제다. answer_value 는 노하우에 적힌 값 그대로'
    + `(${NUMERIC_MIN}~${NUMERIC_MAX} 정수), unit 은 그 단위(도·분·초·ml·그램 등)다. `
    + 'ask 는 무엇의 값을 묻는지 한 줄로 쓴다(예: "우유 스팀, 몇 도까지 올리나요?"). '
    + '★ 탭으로 셀 수 있는 작은 개수(12 이하의 펌프·샷·장)는 이 형태로 내지 마라 — 그건 채워 넣기의 몫이다. '
    + '온도·시간·용량처럼 값이 큰 것만 낸다. 노하우에 그런 값이 없으면 출제하지 마라.',
};
