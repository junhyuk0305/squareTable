// 본사 화면 폭 판정(J15 ④ · 2026-10-05) — 순수 함수. 검증 = scripts/qa-j15.mjs.
// 본사 화면은 넓은 웹 전용이다. 이보다 좁으면 "컴퓨터에서 열어 주세요" 안내 한 장을 보인다.
export const HQ_MIN_WIDTH = 900;

export function hqNarrow(width: number): boolean {
  return width < HQ_MIN_WIDTH;
}
