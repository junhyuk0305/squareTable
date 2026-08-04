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

/** 문자열 → 32bit 정수(FNV-1a). 같은 문항이면 언제 열어도 같은 값이 나와야 한다. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * seed 로 정해지는 순열. ★ Math.random() 금지 —
 * 같은 문항을 다시 열었는데 좌우 배치가 바뀌면 사장이 자기 문제를 못 알아본다.
 * 서버 셔플과 같을 필요는 없다(사장이 자기 문제를 시험해 보는 것뿐이라 채점이 이 배열 안에서 닫힌다).
 */
function shuffled(arr: string[], seed: string): string[] {
  return arr
    .map((v, i) => ({ v, k: hash(`${seed}#${i}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

/**
 * 원본 payload → 렌더러가 읽는 모양.
 * 13개 형태 중 match_line 하나만 어긋난다 — 원본은 pairs[{left,right}] 인데
 * 렌더러(MatchLine)는 서버가 분해해 준 lefts[]/rights[] 를 읽기 때문이다.
 * pairs 는 지우지 않는다: matchLine.grade() 가 pairs 로 채점하고 rights 가 있으면 그 자리를 기준으로 삼는다.
 */
export function previewPayload(
  format: QuizFormat,
  payload: Record<string, any>,
  seed: string,
): Record<string, any> {
  if (format !== 'match_line') return payload;
  const pairs: any[] = Array.isArray(payload?.pairs) ? payload.pairs : [];
  return {
    ...payload,
    lefts: pairs.map((p) => String(p?.left ?? '')),
    rights: shuffled(pairs.map((p) => String(p?.right ?? '')), seed),
  };
}

/**
 * 틀렸을 때 렌더러에 넘길 정답 — 서버 grade_quiz 가 돌려주는 것과 **같은 좌표계**여야 한다
 * (렌더러는 서버 답인지 미리보기 답인지 구분하지 않는다).
 * payload 는 previewPayload() 를 통과한 것을 넣는다 — match_line 이 화면에 보이는 rights 자리를 쓴다.
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
    case 'match_line': {
      const pairs: any[] = Array.isArray(payload?.pairs) ? payload.pairs : [];
      const rights: string[] = Array.isArray(payload?.rights) ? payload.rights.map(String) : [];
      const map: Record<number, number> = {};
      pairs.forEach((p, i) => {
        const at = rights.indexOf(String(p?.right ?? ''));
        if (at >= 0) map[i] = at;
      });
      return map;
    }
    // 선택형 8종(mc4·order_pick·value_pick·trap_pick·pair_pick·case_pick·name_pick·chosung)
    default:
      return payload?.answer_index ?? null;
  }
}
