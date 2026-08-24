// t1 순서 · 게임형 — 섞인 항목을 순서대로 탭하면 **탭한 그 자리에** 1·2·3·4 번호가 붙는다.
// 07-29 §03 T1 "줄 세우기" · 08-24 UI 카탈로그 ⑥. 20초.
//
// ★ 스택 영역으로 옮기는 방식이 아니다(2026-08-24 사용자 지시로 재설계됨).
//   항목은 처음 자리에 그대로 있고 번호 배지만 붙는다 — 화면이 움직이지 않아 한 손으로 빠르다.
//
// wrong_spot 과 나누는 기준: 저쪽은 **이미 배열된 순서에서 틀린 자리를 알아채는** 과제고,
// 이쪽은 **백지에서 순서를 만드는** 과제다. 07-29 는 현장에서 필요한 게 전자라고 봐서
// wrong_spot 을 1차에 넣었고, 이건 그 다음으로 밀려 있던 것이다.
//
// ★ "거꾸로 세우기"에 별도 플래그를 두지 않는다. UI 가 완전히 같고(마지막 것부터 누르면 된다)
//   채점도 answer_seq 를 역순으로 담으면 그만이라, 플래그를 두면 읽는 코드가 한 곳도 없는
//   순수 메타데이터가 된다. 대신 aiHint 가 "역순으로 담아라"를 못박는다.

import type { FormatSpec } from './spec';
import type { QuizResponse } from '../types';
import { INT, STR, checkAsk, checkTexts, strArray } from './spec';

/** 한 판 20초 안에 다 눌러야 하므로 상한을 둔다(07-29 §04 규칙 2). */
const MAX_ITEMS = 6;
const MIN_ITEMS = 3;

/** 같은 이름이 둘이면 어느 쪽을 먼저 눌러야 할지 응시자가 알 수 없다. 짝: 엣지 quizFormats.ts. */
function checkUniqueItems(items: any): string | null {
  const list = (items ?? []).map((v: any) => String(v ?? '').trim());
  return new Set(list).size === list.length ? null : '같은 항목이 두 번 들어 있어요.';
}

/** answer_seq 가 items 전체를 한 번씩 쓰는 순열인지. 빠지거나 겹치면 채점이 성립하지 않는다. */
function checkSeq(seq: any, n: number): string | null {
  if (!Array.isArray(seq) || seq.length !== n) return '순서를 항목 수만큼 정해 주세요.';
  const seen = new Set<number>();
  for (const v of seq) {
    if (!Number.isInteger(v) || v < 0 || v >= n) return '순서에 없는 항목이 들어 있어요.';
    if (seen.has(v)) return '같은 항목이 순서에 두 번 들어 있어요.';
    seen.add(v);
  }
  return null;
}

export const orderBuild: FormatSpec = {
  key: 'order_build',
  kind: 't1',
  label: '순서대로 누르기',
  seconds: 20,
  // 서버 0158 quiz_strip_payload 와 동일해야 함
  stripKeys: ['answer_seq', 'explain'],
  grade: (payload, res: QuizResponse) => {
    const want = payload?.answer_seq;
    if (!Array.isArray(res) || !Array.isArray(want) || res.length !== want.length) return false;
    // ★ 순서가 곧 답이다 — mine_tap 처럼 정렬·중복제거하면 안 된다.
    return res.every((v, i) => v === want[i]);
  },
  validate: (payload) =>
    checkAsk(payload)
    ?? checkTexts(payload?.items, MIN_ITEMS, MAX_ITEMS, '항목')
    ?? checkUniqueItems(payload?.items)
    ?? checkSeq(payload?.answer_seq, payload?.items?.length ?? 0),
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      items: strArray(MAX_ITEMS),
      answer_seq: { type: 'array', items: INT, maxItems: MAX_ITEMS },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'items', 'answer_seq'],
  },
  aiHint:
    '노하우의 단계를 items 에 **순서를 섞어서** 담고, answer_seq 에는 올바른 순서대로 그 항목의 '
    + `위치(0부터)를 담아라. 예: items 가 ["바닥 청소","POS 정산"] 이고 POS 정산이 먼저면 answer_seq 는 [1,0] 이다. `
    + `단계는 ${MIN_ITEMS}~${MAX_ITEMS}개, 노하우에 있는 것만 쓴다. `
    + '"마지막에 하는 것부터" 같이 거꾸로 묻고 싶으면 ask 를 그렇게 쓰고 answer_seq 자체를 역순으로 담아라. '
    + '순서가 중요하지 않은 나열이면 출제하지 마라.',
};
