/**
 * 하단 탭바에서 어느 칸을 켤지(화면조립표 2026-11-17 11절 5번). 순수 함수다. 검사 = scripts/qa-tab-pick.mjs.
 * - 칸의 경로·하위 경로·계열 서브화면(also)이면 그 칸.
 * - 아니면 하위 화면이다. 들어온 탭(lastTab = 마지막으로 켜진 칸의 경로)의 칸을 켠다.
 * - 들어온 탭을 모르면(주소로 바로 들어옴) 아무 칸도 켜지 않는다(-1).
 */
export type TabPath = { path: string; also?: string[] };

/** 자기 경로 + 하위 경로(`/base/...`) + 계열 서브화면. 탭바와 넓은 웹 사이드바가 같이 쓴다. */
export function matchesTab(t: TabPath, pathname: string): boolean {
  const match = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return match(t.path) || (t.also?.some(match) ?? false);
}

export function pickActiveTab(tabs: TabPath[], pathname: string, lastTab: string | null): number {
  const own = tabs.findIndex((t) => matchesTab(t, pathname));
  if (own >= 0) return own;
  return lastTab ? tabs.findIndex((t) => t.path === lastTab) : -1;
}
