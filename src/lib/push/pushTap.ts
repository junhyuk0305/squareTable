// lib/push/pushTap.ts
// 푸시 알림을 눌렀을 때 무엇을 할지 정하는 순수 함수(Q24 · Q25 · 보안 M8). 화면 이동은 nativepush.ts 가 한다.
//
// data = 엣지가 싣는 { url, unitId?, route? }. 새 엣지는 셋 다 서버 값이다. 옛 엣지는 url 만 싣는다.
// ★앱 안 경로 허용 목록만 따른다. "https://", "//", 역슬래시, 모르는 경로는 무시한다(동료가 가짜 주소를 보낼 수 있다).
import { routeForRole } from '@/lib/utils/roles';

export type PushTapPlan =
  | { kind: 'ignore' }
  | { kind: 'push'; to: string }
  /** 다른 매장 알림 — 그 매장으로 들어간 뒤(useStoreEntryStore.enter) then 을 연다. */
  | { kind: 'enter'; unitId: string; then: string };

// 푸시가 여는 앱 안 경로의 첫 칸. 엣지가 싣는 값(push/index.ts · member_notices)이 전부 여기 있다.
const APP_ROOTS = ['owner', 'junior', 'billing', 'stores', 'hub', 'notifications'];
// 매장 화면만 매장을 바꾼다. /stores · /billing 같은 계정 화면은 지금 매장에서 연다.
const STORE_ROOTS = ['owner', 'junior'];

function firstSegment(path: string): string {
  return path.slice(1).split(/[/?#]/)[0];
}

function appPath(v: unknown): string | null {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\\\s]/.test(v)) return null;
  if (v === '/') return v;
  return APP_ROOTS.includes(firstSegment(v)) ? v : null;
}

export function pushTapPlan(data: unknown, session: { unitId: string; role: string }): PushTapPlan {
  const d = (data ?? {}) as { url?: unknown; route?: unknown; unitId?: unknown };
  // route 가 있으면 먼저 쓴다(사장 알림 종류별 화면 · Q25). 옛 엣지는 url 만 있다.
  const dest = d.route !== undefined ? appPath(d.route) : appPath(d.url);
  if (!dest) return { kind: 'ignore' };
  const unitId = typeof d.unitId === 'string' ? d.unitId : '';
  if (unitId && unitId !== session.unitId && STORE_ROOTS.includes(firstSegment(dest))) {
    // 역할 보정(routeForRole)은 전환 뒤 그 매장의 역할로 enter 가 한다.
    return { kind: 'enter', unitId, then: dest };
  }
  return { kind: 'push', to: routeForRole(dest, session.role) };
}
