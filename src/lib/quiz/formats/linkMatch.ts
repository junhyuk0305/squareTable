// t4 대응 · 게임형 — 왼쪽 하나를 누르고 오른쪽 하나를 누르면 **두 항목 사이에 선이 그어진다**.
// 08-24 UI 카탈로그 ⑩. 25초.
//
// flip_match(뒤집기)와 나누는 기준: 저쪽은 **가려 놓고 기억으로** 맞추는 훈련이고,
// 이쪽은 **처음부터 다 보여 주고 관계를 아는지** 묻는 시험이다. 그래서 이쪽은 정답이 안 내려간다.
//
// ★ 드래그가 아니라 탭 두 번이다(07-29 §04 규칙 3 — 한 손 · 이동 동작 금지).
//
// ── 좌표계 ★★ 0107 §5 의 그 함정 그대로 ────────────────────────────────────
// 저장 payload : { ask, pairs: [{left, right}], explain }
// 응시 payload : { ask, lefts: [...원본 순서], rights: [...결정적 셔플] }
//   오른쪽을 원본 순서로 내려보내면 "i번째끼리 잇기"가 그대로 정답이 된다 → 반드시 섞어야 한다.
//   섞기는 서버(quiz_right_perm)가 문항 id + created_at 시드로 한다. 클라는 시드를 모른다.
// 응답        : { "<왼쪽 원본 index>": <오른쪽이 놓인 섞인 자리> } — **오른쪽은 받은 배열의 index 그대로**.
//   폐기된 match_line 과 완전히 같은 좌표계라, 서버 strip·채점 분기를 새로 만들지 않고 같이 쓴다
//   (0161 은 기존 match_line 분기에 이름 한 줄을 더했을 뿐이다).

import type { FormatSpec } from './spec';
import type { QuizResponse } from '../types';
import { INT, STR, checkAsk } from './spec';
import { checkPairs } from './flipMatch';

/** 세로 두 줄이 화면을 넘기지 않는 상한. 뒤집기(6)보다 하나 적다 — 줄이 엉켜 보이기 시작하는 지점이다. */
export const LINK_MAX_PAIRS = 5;

export const linkMatch: FormatSpec = {
  key: 'link_match',
  kind: 't4',
  label: '줄 잇기',
  seconds: 25,
  // flip_match 와 같은 이유로 묶음형 — 짝 3쌍이 한 노하우에 다 있는 경우는 드물다.
  bundled: true,
  // 서버 0161 quiz_strip_payload 와 동일해야 함. pairs 가 lefts + rights 로 분해된다(위 주석).
  stripKeys: ['pairs', 'explain'],
  /**
   * ★ 미리보기 전용이다(spec.ts grade 주석 (a)). 미리보기는 저장 payload 를 그대로 넘기므로
   *   오른쪽이 **섞이지 않은 원본 순서**다 → 정답은 항등 사상(i ↔ i)이다.
   *   직원 응시의 채점은 서버가 하고, 서버는 자기가 만든 순열을 되돌려 같은 판정을 한다.
   */
  grade: (payload, res: QuizResponse) => {
    const pairs = payload?.pairs;
    if (!Array.isArray(pairs)) return false;
    if (typeof res !== 'object' || res === null || Array.isArray(res)) return false;
    const picked = res as Record<string, number>;
    if (Object.keys(picked).length !== pairs.length) return false;
    for (let i = 0; i < pairs.length; i++) if (Number(picked[String(i)]) !== i) return false;
    return true;
  },
  validate: (payload) => checkAsk(payload) ?? checkPairs(payload?.pairs, LINK_MAX_PAIRS),
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      pairs: {
        type: 'array',
        maxItems: LINK_MAX_PAIRS,
        items: { type: 'object', properties: { left: STR, right: STR }, required: ['left', 'right'] },
      },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'pairs'],
  },
  aiHint:
    '왼쪽 항목과 오른쪽 항목을 선으로 잇는 문제다. pairs 에 **서로 짝인 것**을 담아라'
    + '(예: 물건 ↔ 두는 자리, 용어 ↔ 뜻, 상황 ↔ 대응). '
    + `짝은 3~${LINK_MAX_PAIRS}쌍이고, left·right 는 한 줄에 들어갈 짧은 말이다. `
    + 'ask 에는 무엇끼리 잇는지 한 줄로 쓴다(예: "물건과 두는 자리를 이어 주세요"). '
    + '같은 말이 두 번 나오면 안 되고, 오른쪽 항목 여러 개에 동시에 해당하는 왼쪽 항목을 만들지 마라. '
    + '대응 관계가 노하우에 없으면 출제하지 마라.',
};
