// 앱이 다시 앞으로 왔을 때 다시 읽을지(J15 ③ · 2026-10-05) — 순수 함수. 검증 = scripts/qa-j15.mjs.
export const FOREGROUND_REFRESH_AFTER_MS = 30000;

/** 뒤(background·inactive)에서 앞(active)으로 오고, 30초 넘게 뒤에 있었으면 true. */
export function shouldRefreshOnForeground(prev: string, next: string, awaySince: number | null, now: number = Date.now()): boolean {
  if (next !== 'active' || prev === 'active' || awaySince === null) return false;
  return now - awaySince >= FOREGROUND_REFRESH_AFTER_MS;
}
