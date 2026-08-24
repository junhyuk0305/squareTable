// t5 갈래 · 게임형 — 조건이 단계적으로 갈린다. 매 단계 예/아니요를 고르면 지나온 경로가 쌓이고,
// 끝에 결과 카드가 뜬다. 08-24 UI 카탈로그 ⑧. 25초.
//
// case_pick(상황 고르기)은 결론 하나를 4개 중에 고르게 한다. 이 형태는 **결론에 이르는 판단 과정**
// 자체를 묻는다 — "포장인가 → 잔이 3개 이상인가 → 캐리어가 있나" 처럼 현장에서 실제로 거치는 갈래다.
//
// ★ 채점은 도착한 결과가 아니라 **밟아 온 경로**로 한다.
//   결과만 보면 서로 다른 갈래가 같은 결과로 모이는 트리에서(위 예의 r0 처럼) 엉뚱하게 밟고도
//   맞은 것이 된다. "판단 과정을 묻는다"는 이 형태의 존재 이유와도 어긋난다.
//   그 대신 응답 모양이 order_build 와 같은 "순서 있는 정수 배열"이라 서버 채점 분기를 나눠 쓴다.

import type { FormatSpec } from './spec';
import type { QuizResponse } from '../types';
import { INT, STR, checkAsk, checkTexts, strArray } from './spec';

const MIN_STEPS = 2;
const MAX_STEPS = 4;
const MAX_RESULTS = 4;

/**
 * 다음 칸 표기 — "s1" = steps[1] 로, "r0" = results[0] 에서 끝.
 * ★ 응시 화면(components/work/quiz/BranchPath.tsx)이 같은 표기를 걸어가야 해서 여기서 내보낸다.
 *   두 곳이 각자 정규식을 들고 있으면 표기를 바꿀 때 한쪽만 고쳐진다.
 */
export function parseBranchNext(v: any): { kind: 's' | 'r'; i: number } | null {
  const m = /^([sr])(\d+)$/.exec(String(v ?? ''));
  return m ? { kind: m[1] as 's' | 'r', i: Number(m[2]) } : null;
}

/**
 * answer_path 를 실제로 걸어 본다. 걸어서 결과 칸에 닿는 순간 경로도 같이 끝나야 한다.
 * 트리와 정답 경로를 따로 만들다 보면 어긋나기 쉬운데(AI 가 특히), 그러면 아무도 못 맞히는
 * 문항이 조용히 저장된다 — 저장 전에 여기서 잡는다.
 */
function checkTree(payload: any): string | null {
  const steps: any[] = payload?.steps ?? [];
  const results: any[] = payload?.results ?? [];
  const path: any[] = payload?.answer_path ?? [];

  for (const s of steps) {
    if (!String(s?.ask ?? '').trim()) return '갈래마다 질문을 적어 주세요.';
    for (const branch of [s?.yes, s?.no]) {
      const n = parseBranchNext(branch);
      if (!n) return '갈래가 어디로 이어지는지 적어 주세요.';
      if (n.kind === 's' && n.i >= steps.length) return '없는 갈래로 이어져 있어요.';
      if (n.kind === 'r' && n.i >= results.length) return '없는 결과로 이어져 있어요.';
    }
  }

  if (!Array.isArray(path) || path.length === 0) return '정답 경로를 정해 주세요.';
  let at = 0;
  for (let k = 0; k < path.length; k++) {
    const pick = path[k];
    if (pick !== 0 && pick !== 1) return '정답 경로는 예(0)·아니요(1)로만 적어 주세요.';
    const n = parseBranchNext(pick === 0 ? steps[at]?.yes : steps[at]?.no);
    if (!n) return '정답 경로가 갈래와 맞지 않아요.';
    if (n.kind === 'r') {
      // 결과에 닿았는데 경로가 남아 있으면 트리와 정답이 어긋난 것이다.
      return k === path.length - 1 ? null : '정답 경로가 결과보다 길어요.';
    }
    at = n.i;
  }
  return '정답 경로가 결과까지 이어지지 않아요.';
}

export const branchPath: FormatSpec = {
  key: 'branch_path',
  kind: 't5',
  label: '갈래 따라가기',
  seconds: 25,
  // 서버 0158 quiz_strip_payload 와 동일해야 함(공통 제거 목록 밖의 키만 여기 적는다)
  stripKeys: ['answer_path', 'explain'],
  grade: (payload, res: QuizResponse) => {
    const want = payload?.answer_path;
    if (!Array.isArray(res) || !Array.isArray(want) || res.length !== want.length) return false;
    return res.every((v, i) => v === want[i]);
  },
  validate: (payload) =>
    checkAsk(payload)
    ?? (Array.isArray(payload?.steps) && payload.steps.length >= MIN_STEPS && payload.steps.length <= MAX_STEPS
      ? null
      : `갈래는 ${MIN_STEPS}에서 ${MAX_STEPS}개 사이로 만들어 주세요.`)
    ?? checkTexts(payload?.results, 2, MAX_RESULTS, '결과')
    ?? checkTree(payload),
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      steps: {
        type: 'array',
        maxItems: MAX_STEPS,
        items: {
          type: 'object',
          properties: { ask: STR, yes: STR, no: STR },
          required: ['ask', 'yes', 'no'],
        },
      },
      results: strArray(MAX_RESULTS),
      answer_path: { type: 'array', items: INT, maxItems: MAX_STEPS },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'steps', 'results', 'answer_path'],
  },
  aiHint:
    'ask 에는 판단해야 할 **구체적인 상황**을 한 줄로 쓴다(예: "포장 주문으로 음료 3잔이 나왔어요"). '
    + `steps 는 그 상황에서 실제로 거치는 예/아니요 갈래 ${MIN_STEPS}~${MAX_STEPS}개다. `
    + '각 갈래의 yes·no 에는 다음에 갈 곳을 "s1"(steps[1] 로) 또는 "r0"(results[0] 에서 끝) 처럼 적는다. '
    + 'results 는 갈래 끝에서 직원이 실제로 하게 될 행동이다. '
    + 'answer_path 는 ask 의 상황에서 **올바르게 답했을 때 밟는 순서**를 예=0·아니요=1 로 담고, '
    + '반드시 결과 칸에 닿는 지점에서 끝나야 한다. '
    + '조건에 따라 대응이 갈리는 내용이 노하우에 없으면 출제하지 마라.',
};
