// 통합 알림(cross-store) 파생 — 판정·목록 구성은 notifications.ts SSOT 를 매장별로 재사용한다.
// 여기서 새 술어를 만들지 않는다(§②). 입력은 db.fetchCrossStoreNotifData(0077 RPC)의 매장별 원시 묶음.
import type { UnitNotifData } from '@/lib/db';
import {
  buildJuniorNotifications,
  buildOwnerNotifications,
  juniorUnreadCount,
  ownerUnreadCount,
  MAX_NOTIFS,
  type JuniorNotif,
  type OwnerNotif,
} from './notifications';

/** 통합 리스트 한 행 = 기존 알림 행 + 어느 매장 것인지(unitId). 매장명·색 표시는 화면이 붙인다. */
export type CrossNotifRow = (JuniorNotif | OwnerNotif) & { unitId: string };

/** 매장 하나의 안읽음 카운트 — 그 매장에서의 역할(unit_members.role)에 맞는 기존 카운터 재사용.
 *  ackAt = 그 매장의 '모두 읽기' 기준 시각(0078, unit_member_prefs — 전 매장 행을 이미 당겨둠). */
export function storeUnreadCount(d: UnitNotifData, role: string, me: string, today: string, ackAt?: string | null): number {
  return role === 'owner'
    ? ownerUnreadCount(d.queue, d.suggestions, d.swaps, d.pending, d.feed, me, ackAt)
    : juniorUnreadCount(d.feed, d.swaps, me, today, d.taskTemplates, d.done, ackAt, d.suggestions);
}

/** 매장 하나의 알림 목록 — 기존 빌더 재사용(교대 시간표기용 ShiftTemplate 은 cross-store 미제공 → 날짜만). */
export function buildStoreNotifs(d: UnitNotifData, role: string, me: string, today: string, ackAt?: string | null): CrossNotifRow[] {
  const nameOf = (id: string) => (id === me ? '나' : d.names[id] || (role === 'owner' ? '직원' : '동료'));
  const rows: (JuniorNotif | OwnerNotif)[] =
    role === 'owner'
      ? buildOwnerNotifications({ queue: d.queue, suggestions: d.suggestions, swaps: d.swaps, pending: d.pending, nameOf, feed: d.feed, userId: me, ackAt })
      : buildJuniorNotifications({ feed: d.feed, swaps: d.swaps, templates: [], nameOf, userId: me, today, taskTemplates: d.taskTemplates, done: d.done, ackAt, suggestions: d.suggestions });
  return rows.map((r) => ({ ...r, unitId: d.unitId }));
}

/** 전 매장 병합 목록(시간 역순, 단일 매장과 동일 상한). */
export function mergeCrossNotifs(perStore: CrossNotifRow[][]): CrossNotifRow[] {
  return perStore.flat().sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTIFS);
}
