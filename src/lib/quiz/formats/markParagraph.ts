// t3 배제 · 게임형 — **이어진 문장** 안에서 잘못된 부분을 여러 곳 탭해 표시한다. 08-24 UI 카탈로그 ⑭. 25초.
//
// mine_tap(지뢰 밟기)과 나누는 기준은 **재료의 모양**이다.
//   · mine_tap      : 끊어진 행동 카드가 하나씩 지나간다. 카드마다 누를지 말지를 정한다.
//   · mark_paragraph: "직원이 남긴 인수인계 메시지" 한 덩어리를 읽고 규정과 다른 곳을 짚는다.
//     문장이 이어져 있어서 앞뒤 맥락을 읽어야 하고, 실제로 인수인계를 검토하는 동작과 같다.
//
// ★ 탭할 수 있는 문구에는 화면이 **점선 밑줄을 기본으로 깔아 둔다**(사용자 확정 08-24).
//   안 그러면 어디를 누를 수 있는지 알 수 없어 문항이 성립하지 않는다. 그래서 `tap` 은 정답 키가
//   **아니고**(어디가 틀렸는지를 말해 주지 않는다) 응시 payload 에 그대로 남는다.
//   감추는 것은 `is_wrong` 하나뿐이다 — 서버가 파트마다 지운다.
//
// ── 좌표계 ────────────────────────────────────────────────────────────────
// 저장 payload : { ask, parts: [{ text, tap, is_wrong }], explain }
//   parts 는 **읽는 순서 그대로**다. tap=false 인 파트는 문장을 잇는 글(누를 수 없다).
//   섞지 않는다 — 섞으면 문장이 아니게 된다(link_match 처럼 순열을 쓸 자리가 없다).
// 응시 payload : { ask, parts: [{ text, tap }] }  ← 0168 quiz_strip_payload
// 응답        : number[] — 탭한 파트의 **parts 배열 index**. mine_tap 과 같은 집합 비교다.

import type { FormatSpec } from './spec';
import { INT, STR } from './spec';

/** 한 문단의 조각 수 상한. 넘기면 한 화면에 안 들어가고 25초를 넘긴다(07-29 §04 규칙 2). */
const MAX_PARTS = 14;
/** 누를 수 있는 문구의 하한·상한. 하나뿐이면 짚을 곳이 하나라 문제가 안 되고, 8을 넘으면 판이 늘어진다. */
const MIN_TAPS = 3;
const MAX_TAPS = 8;

/** 이 파트를 누를 수 있나. is_wrong 은 tap 인 파트에서만 뜻이 있다. */
const isTap = (p: any): boolean => p?.tap === true;
const isWrong = (p: any): boolean => p?.is_wrong === true;

export const markParagraph: FormatSpec = {
  key: 'mark_paragraph',
  kind: 't3',
  label: '잘못된 곳 짚기',
  seconds: 25,
  // 서버 0168 quiz_strip_payload 와 동일해야 함 (+ parts[].is_wrong 제거 — 위 주석).
  stripKeys: ['explain'],
  grade: (payload, res) => {
    const parts = payload?.parts;
    if (!Array.isArray(parts) || !Array.isArray(res)) return false;
    const tapped = new Set((res as number[]).filter((n) => Number.isInteger(n)));
    // 부분점수 없음 — 표시한 집합이 정답 집합과 정확히 같아야 한다(mine_tap 과 같은 기준).
    return parts.every((p: any, i: number) => tapped.has(i) === isWrong(p));
  },
  validate: (payload) => {
    if (!String(payload?.ask ?? '').trim()) return '질문을 적어 주세요.';
    const parts = payload?.parts;
    if (!Array.isArray(parts) || parts.length < 2) return '문장을 두 조각 이상으로 나눠 주세요.';
    if (parts.length > MAX_PARTS) return `조각은 ${MAX_PARTS}개까지 넣을 수 있어요.`;
    if (parts.some((p: any) => !String(p?.text ?? '').trim())) return '조각 내용을 모두 채워 주세요.';
    const taps = parts.filter(isTap);
    if (taps.length < MIN_TAPS) return `누를 수 있는 문구를 ${MIN_TAPS}개 이상 만들어 주세요.`;
    if (taps.length > MAX_TAPS) return `누를 수 있는 문구는 ${MAX_TAPS}개까지 넣을 수 있어요.`;
    // 누를 수 없는 조각에 정답을 숨기면 응시자가 영원히 못 맞힌다.
    if (parts.some((p: any) => isWrong(p) && !isTap(p))) return '잘못된 곳은 누를 수 있는 문구에서 골라 주세요.';
    const wrongs = taps.filter(isWrong).length;
    if (wrongs === 0) return '잘못된 곳을 1개 이상 골라 주세요.';
    if (wrongs === taps.length) return '맞게 적힌 문구도 1개 이상 있어야 해요.';
    return null;
  },
  aiSchema: {
    type: 'object',
    properties: {
      ask: STR,
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: STR, tap: { type: 'boolean' }, is_wrong: { type: 'boolean' } },
          required: ['text', 'tap', 'is_wrong'],
        },
        maxItems: MAX_PARTS,
      },
      explain: STR,
      source_index: INT,
    },
    required: ['ask', 'parts'],
  },
  aiHint:
    '**직원이 남긴 인수인계 메시지**를 읽고 규정과 다른 곳을 짚는 문제다. '
    + '"안내문·공지" 같은 딱딱한 글이 아니라, 마감을 끝낸 직원이 실제로 남길 법한 말투로 쓴다'
    + '(예: "오늘 마감은 포스 정산부터 하고 원두 호퍼를 비운 뒤 바닥을 청소했어요"). '
    + 'parts 는 그 메시지를 읽는 순서 그대로 조각낸 것이다. 순서를 섞지 마라 — 이어 붙이면 한 문단이 돼야 한다. '
    + `tap=true 는 누를 수 있는 문구(${MIN_TAPS}~${MAX_TAPS}개), tap=false 는 문장을 잇는 글이다. `
    + 'is_wrong=true 는 그 문구가 노하우의 순서·금지와 어긋난다는 뜻이고, tap=true 인 조각에만 붙인다. '
    + '틀린 문구와 맞는 문구가 각각 1개 이상 있어야 한다. '
    + '틀린 문구는 노하우에 근거가 분명한 것만 쓰고, 맞는 문구는 같은 노하우의 정상 절차에서 뽑아라. '
    + '조건이 갈리는 내용이나 규정과 대조할 것이 노하우에 없으면 출제하지 마라.',
};
