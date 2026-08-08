// 사장 미리보기 — 저장된 **원본 payload**(정답 포함)를 "직원이 보는 모양"으로 맞춘다.
//
// ★ 이 파일은 서버 quiz_strip_payload(0107 quiz_items_for)의 복제가 아니다. 목적이 반대다.
//     서버가 하는 일 = **정답을 지운다**. 응시자가 정답 키를 손에 쥐면 그게 곧 유출이라서다.
//     여기가 하는 일 = **표시 모양만 맞춘다**. 정답은 그대로 둔다.
//   사장은 자기가 만든 문항의 정답을 이미 안다 — 지울 이유가 없고, 지우면 클라 채점(FORMATS[f].grade)이
//   불가능해져 미리보기가 성립하지 않는다(formats/spec.ts 의 grade 주석 (a) 용도가 이것이다).
//   따라서 서버 제거 목록이 바뀌어도 이 파일은 따라갈 필요가 없다. 짝이 아니다.
//
// ⛔ 직원 응시 경로(src/components/work/UnderstandingCheckSheet.tsx)에서는 절대 쓰지 않는다.
//    거기서는 채점도 payload 도 서버가 준 것만 쓴다.

import type { QuizFormat } from './types';

/**
 * 틀렸을 때 렌더러에 넘길 정답 — 서버 grade_quiz 가 돌려주는 것과 **같은 좌표계**여야 한다
 * (렌더러는 서버 답인지 미리보기 답인지 구분하지 않는다).
 * ★ 저장된 payload 를 그대로 넣는다. 표시 모양을 손보는 단계(previewPayload)가 있었지만
 *   그건 match_line 하나 때문이었고, 2026-08-08 t4 폐기와 함께 없앴다.
 */
export function previewAnswer(format: QuizFormat, payload: Record<string, any>): any {
  switch (format) {
    case 'wrong_spot':
      return payload?.wrong_index ?? null;
    case 'fill_count':
      return payload?.target ?? null;
    case 'mine_tap':
      return (Array.isArray(payload?.cards) ? payload.cards : [])
        .map((c: any, i: number) => (c?.is_mine === true ? i : -1))
        .filter((i: number) => i >= 0);
    case 'quick_judge':
      return (Array.isArray(payload?.cards) ? payload.cards : []).map((c: any) => Number(c?.answer));
    // 선택형 7종(mc4·order_pick·value_pick·trap_pick·case_pick·name_pick·chosung)
    default:
      return payload?.answer_index ?? null;
  }
}
