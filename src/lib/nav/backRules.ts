// 안드로이드 뒤로가기 규칙표(J13 · 설계 05 §4 "뒤로가기 지도"). 순수 함수 — RN 을 import 하지 않는다.
// 부르는 곳 = BackRulesBinder(안드 전용). iOS 는 시스템 제스처 그대로, 웹은 브라우저 뒤로 그대로다.
//
// 왜 필요한가: 탭 이동(goToTab)과 매장 진입(useStoreEntryStore.enter)이 모두 replace 라 탭 루트에서는 스택이 비어
// 있다. 그래서 react-navigation 기본 처리는 매장 탭·매장 홈에서 뒤로를 누르면 앱을 닫았다.

/** 'default' = OS 기본(앱 종료) · 'consume' = 무시 · 'pop' = 이전 화면 · '/경로' = 그 화면으로 replace */
export type BackAction = 'default' | 'consume' | 'pop' | `/${string}`;

export type BackCtx = {
  /** 매장 진입 커버 중(useStoreEntryStore.entering) */
  entering: boolean;
  /** 가까운 스택에 이전 화면이 있다(router.canDismiss) */
  canDismiss: boolean;
  /** 세션 역할(활성 매장 멤버십 기준) */
  role: string;
  /** 매장에 들어오기 전 마지막 허브 탭(hubTabOf 로 기록). 없으면 null */
  origin: string | null;
};

const HUB_TABS = ['/hub', '/hub-growth', '/stores'];
const STORE_HOMES = ['/owner/dashboard', '/junior/home'];
/** 매장 탭(홈 말고). 매니저는 직원 탭 세트를 쓰지만 업무 채팅은 /owner/work 로 연다. */
const STORE_TABS = [
  '/owner/categories', '/owner/training', '/owner/work', '/owner/settings',
  '/junior/chat', '/junior/work', '/junior/attendance', '/junior/settings',
];
/** 강제 화면 — 뒤로로 우회하지 못하게 OS 기본(앱 종료)에 맡긴다. */
const FORCED = ['/complete-profile', '/downgrade'];

/** 허브 탭이면 그 경로, 아니면 null. 매장 홈의 뒤로 목적지(origin)를 기록할 때 쓴다. */
export function hubTabOf(path: string): string | null {
  return HUB_TABS.includes(path) ? path : null;
}

export function backAction(path: string, ctx: BackCtx): BackAction {
  if (FORCED.includes(path)) return 'default';
  if (ctx.entering) return 'consume';
  if (ctx.canDismiss) return 'pop';
  if (STORE_HOMES.includes(path)) return (hubTabOf(ctx.origin ?? '') as `/${string}` | null) ?? '/stores';
  if (STORE_TABS.includes(path)) return ctx.role === 'owner' ? '/owner/dashboard' : '/junior/home';
  if (path === '/hub-growth' || path === '/stores') return '/hub';
  return 'default';
}
