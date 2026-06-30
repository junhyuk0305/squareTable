/** 숫자 배지 캡 — 100 이상은 '99+'로 줄여 표기. */
export function capCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}
