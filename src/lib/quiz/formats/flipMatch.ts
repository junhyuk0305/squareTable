// t4 대응 · 게임형 — 엎어 둔 카드를 두 장 뒤집어 **짝이면 고정, 아니면 다시 덮인다**.
// 07-29 §03 이 "최고 형태"로 지목한 자리 · 08-24 UI 카탈로그 ⑨. 30초.
//
// 다른 형태는 "아는지"를 묻는다. 이 형태만 **반복 노출로 저절로 외워지게** 만든다 — 한 판에서
// 같은 짝을 여러 번 보게 되기 때문이다(뒤집고 덮이고 다시 뒤집는다). 그래서 시험이 아니라 훈련이다.
//
// ── ★★ 여기만 정답 유출 규칙의 예외다. 반드시 읽을 것 ──────────────────────
// 매칭 게임은 "두 장이 짝인가"를 **화면이 그 자리에서** 판정해야 성립한다(짝이면 고정, 아니면 덮기).
// 서버에 물어보러 갈 시간이 없다 → 응시 payload 에 **어느 카드끼리 짝인지**가 들어가야 한다.
// 그래서 서버 strip 은 pairs 를 지우되 `cards[].group`(같은 숫자 = 같은 짝)을 남긴다.
//   · 다른 형태처럼 "정답을 못 보게" 만들 방법이 **없다** — 자동 채점을 포기하거나, 형태를 포기하거나 둘 중 하나다.
//   · 대신 이 형태는 등수를 매기는 문항이 아니다. 정직하게 끝까지 뒤집으면 항상 맞는다.
//     서버 채점이 잡는 것은 "판을 실제로 끝냈는가"(짝이 아닌 둘을 묶었거나, 카드를 빠뜨린 응답)뿐이다.
// ⛔ 이 예외를 다른 형태로 복사하지 말 것. 나머지 13종은 정답 키가 절대 내려가지 않는다.
//
// ── 좌표계 ────────────────────────────────────────────────────────────────
// 저장 payload : { ask, pairs: [{left, right}], explain }
// 응시 payload : { ask, cards: [{text, group}] }  ← 0161 quiz_strip_payload 가 만든다.
//   카드 원본 번호(canonical) c 는 c/2 = 짝 번호, c%2 = 0 이면 left · 1 이면 right.
//   응시용 cards 는 그 2n 장을 **결정적으로 섞은 것**이고, 응답은 언제나 **받은 cards 배열의 index** 다.
// 응답        : number[] — 짝으로 고정한 순서대로의 카드 index (a1,b1,a2,b2,…), 길이 = 카드 수.

import type { FormatSpec } from './spec';
import type { QuizResponse } from '../types';
import { INT, STR, checkAsk } from './spec';

const MIN_PAIRS = 3;
/** 3열 그리드 기준 최대 4줄. 더 늘리면 한 판이 30초를 넘긴다(07-29 §04 규칙 2). */
export const FLIP_MAX_PAIRS = 6;

/**
 * 짝 목록 공통 검사. flip_match·link_match 가 같이 쓴다.
 * ★ 양쪽 칸의 글자가 **전부 서로 달라야** 한다 — 같은 글자가 두 장 있으면 어느 것이 짝인지
 *   응시자가 알 수 없고(뒤집기), 선을 어디에 그어도 맞는 문항이 된다(짝짓기).
 */
export function checkPairs(pairs: any, max: number): string | null {
  if (!Array.isArray(pairs) || pairs.length < MIN_PAIRS) return `짝은 ${MIN_PAIRS}쌍 이상이어야 해요.`;
  if (pairs.length > max) return `짝은 ${max}쌍까지 넣을 수 있어요.`;
  const texts: string[] = [];
  for (const p of pairs) {
    const l = String(p?.left ?? '').trim();
    const r = String(p?.right ?? '').trim();
    if (!l || !r) return '짝의 양쪽을 모두 채워 주세요.';
    texts.push(l, r);
  }
  if (new Set(texts).size !== texts.length) return '같은 내용이 두 번 들어 있어요.';
  return null;
}

/** 카드 번호 c 가 속한 짝 번호. 응시용으로 섞기 전(canonical) 좌표계에서만 쓴다. */
const groupOf = (c: number) => Math.floor(c / 2);

export const flipMatch: FormatSpec = {
  key: 'flip_match',
  kind: 't4',
  label: '뒤집어 짝 찾기',
  seconds: 30,
  // 짝 3쌍 이상이 한 노하우에 다 있는 경우는 드물다 → 여러 건을 섞어야 한 판이 된다(mine_tap 과 같다).
  bundled: true,
  // 서버 0161 quiz_strip_payload 와 동일해야 함. pairs 는 지워지지만 그 자리에 cards 가 생긴다(위 주석).
  stripKeys: ['pairs', 'explain'],
  /**
   * ★ 미리보기 전용이다(spec.ts grade 주석 (a)). 미리보기는 저장 payload 를 그대로 넘기므로
   *   카드 좌표계가 **섞이기 전 canonical** 이다 — 그래서 짝 판정이 c/2 로 끝난다.
   *   직원 응시의 채점은 서버가 하고, 서버는 섞은 cards 의 group 으로 같은 판정을 한다.
   */
  grade: (payload, res: QuizResponse) => {
    const pairs = payload?.pairs;
    if (!Array.isArray(pairs) || !Array.isArray(res)) return false;
    const n = pairs.length * 2;
    if (res.length !== n) return false;
    const seen = new Set<number>();
    for (const v of res) {
      if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
      seen.add(v);
    }
    for (let k = 0; k < n; k += 2) if (groupOf(res[k]) !== groupOf(res[k + 1])) return false;
    return true;
  },
  validate: (payload) => checkAsk(payload) ?? checkPairs(payload?.pairs, FLIP_MAX_PAIRS),
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      pairs: {
        type: 'array',
        maxItems: FLIP_MAX_PAIRS,
        items: { type: 'object', properties: { left: STR, right: STR }, required: ['left', 'right'] },
      },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'pairs'],
  },
  aiHint:
    '노하우에서 **서로 짝인 것 둘**을 뽑아 pairs 에 담아라(예: 물건 ↔ 두는 자리, 용어 ↔ 뜻, 상황 ↔ 대응). '
    + `짝은 ${MIN_PAIRS}~${FLIP_MAX_PAIRS}쌍이고, left·right 는 카드에 들어갈 짧은 말이다(10자 안쪽이 좋다). `
    + 'ask 에는 무엇끼리 맞추는 판인지 한 줄로 쓴다(예: "물건과 두는 자리를 맞춰 주세요"). '
    + '같은 말이 두 번 나오면 안 된다. 대응 관계가 노하우에 없으면 출제하지 마라.',
};
