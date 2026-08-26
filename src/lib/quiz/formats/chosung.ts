// t6 이름 · 게임형 — ㅂㄱㅍㄹㅅ → 백플러시. 07-29 §03 T6 ★★ 10초.
//
// 07-29 판단: 이미 다들 아는 놀이라 설명이 0줄이고 한 판이 10초다. 한국어라서 되는 형태.
// 난이도 3단은 선택지를 3개 → 5개로 늘려서 만든다(§04 규칙 5) → 선택지 상한 5.
// chosung 은 문제의 일부라 응시 화면에도 그대로 보인다(stripKeys 대상 아님).

import { STR, choicePickSpec } from './spec';

// ── 초성 추출 ──────────────────────────────────────────────
// ★★ 초성은 **정답에서 계산되는 값**이지 사람이나 모델이 정하는 값이 아니다.
//   2026-08-27 실측: 모델이 "손목 회전 한 번"(6자)에 초성을 **7개**(ㅅ ㅁ ㅎ ㅈ ㅎ ㅂ ㅂ) 붙였다.
//   응시자는 7글자 단어를 찾게 되고 정답은 6글자다 — **풀 수 없는 문항**이 그대로 나갔다.
//   validate 가 개수를 안 봐서 저장도, 출제도 막히지 않았다.
//   → 계산은 결정적이니 아예 **모델에게 시키지 않는다**(엣지 normalize 가 이 값을 덮어쓴다).
//     validate 의 개수 검사는 사장이 직접 만든 문항과 옛 데이터를 거르는 두 번째 그물이다.
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 초성 토큰 — 공백을 뺀 글자 수와 **반드시 같은 개수**가 나온다. */
export function chosungTokens(word: string): string[] {
  return [...String(word ?? '')]
    .filter((ch) => ch.trim())                      // 공백은 글자로 세지 않는다(정답 비교 기준과 같게)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      // 한글 음절이면 초성으로, 아니면(영문·숫자·기호) 글자를 그대로 둔다 — "POS 정산" 같은 용어가 있다.
      return code >= 0xac00 && code <= 0xd7a3 ? CHO[Math.floor((code - 0xac00) / 588)] : ch;
    });
}

/** 화면·payload 에 넣는 모양. 띄어 적어야 몇 글자인지 보인다(07-29 예: 백플러시 → "ㅂ ㅍ ㄹ ㅅ"). */
export function chosungOf(word: string): string {
  return chosungTokens(word).join(' ');
}

/** 공백을 뺀 글자 수 — 초성 개수와 맞춰 보는 기준. */
const lettersOf = (word: string): number => [...String(word ?? '')].filter((ch) => ch.trim()).length;

export const chosung = choicePickSpec({
  key: 'chosung',
  kind: 't6',
  label: '초성',
  seconds: 10,
  maxChoices: 5,
  extraSchema: { chosung: STR },
  extraRequired: ['chosung'],
  validateExtra: (payload) => {
    const given = String(payload?.chosung ?? '').trim();
    if (!given) return '초성을 적어 주세요.';
    // ★개수가 안 맞으면 응시자가 찾는 글자 수와 정답의 글자 수가 달라 **풀 수 없는 문항**이 된다.
    //   정답을 아직 못 고른 상태(answer_index 가 범위 밖)면 여기서 판정하지 않는다 —
    //   그건 choicePickSpec 의 checkIndex 가 뒤이어 자기 말로 알려준다.
    const answer = payload?.choices?.[payload?.answer_index];
    if (typeof answer !== 'string') return null;
    const n = given.split(/\s+/).filter(Boolean).length;
    const want = lettersOf(answer);
    if (want === 0) return null;                    // 정답 칸이 비었으면 checkChoices 가 말한다
    if (n !== want) return `초성이 정답과 글자 수가 달라요. ${want}글자에 맞춰 ${want}개로 적어 주세요.`;
    return null;
  },
  aiHint:
    '매장 용어의 초성만 보여주고 맞히는 문제다. ask 에는 그 용어가 무엇인지 한 줄 설명을 쓴다. '
    + '선택지는 3~5개이고 정답은 노하우에 실제로 나오는 용어여야 한다. '
    + '일반 명사는 출제하지 마라. '
    // ★초성 칸은 서버가 정답에서 직접 만든다 — 모델이 적은 값은 버려진다(글자 수를 자꾸 틀렸다).
    + 'chosung 칸은 비워 두거나 대충 적어도 된다. 서버가 정답에서 다시 만든다.',
});
