// 통합 알림(cross-store) 파생 — 판정·목록 구성은 notifications.ts SSOT 를 매장별로 재사용한다.
// 여기서 새 술어를 만들지 않는다(§②). 입력은 db.fetchCrossStoreNotifData(0077 RPC)의 매장별 원시 묶음.
import type { UnitNotifData } from '@/lib/db';
import {
  buildJuniorNotifications,
  buildManagerNotifications,
  buildOwnerNotifications,
  isPendingAssignment,
  juniorUnreadCount,
  managerUnreadCount,
  ownerUnreadCount,
  MAX_NOTIFS,
  type JuniorNotif,
  type ManagerNotif,
  type ManagerReceivedArgs,
  type OwnerNotif,
} from './notifications';
import { canManage } from './roles';

/** 통합 리스트 한 행 = 기존 알림 행 + 어느 매장 것인지(unitId). 매장명·색 표시는 화면이 붙인다. */
export type CrossNotifRow = (JuniorNotif | OwnerNotif | ManagerNotif) & { unitId: string };

// 매장 하나에서 쓸 인자 묶음 — 카운트와 목록이 **같은 입력**을 보게 한 곳에서 만든다.
const ownerArgsOf = (d: UnitNotifData, me: string, nameOf: (id: string) => string, ackAt?: string | null) =>
  ({ queue: d.queue, suggestions: d.suggestions, swaps: d.swaps, pending: d.pending, nameOf, feed: d.feed, userId: me, ackAt });
const receivedArgsOf = (
  d: UnitNotifData, me: string, today: string, nameOf: (id: string) => string, ackAt?: string | null,
): ManagerReceivedArgs =>
  ({ feed: d.feed, taskTemplates: d.taskTemplates, done: d.done, today, suggestions: d.suggestions, userId: me, nameOf, ackAt });

/** 매장 하나의 안읽음 카운트 — 그 매장에서의 역할(unit_members.role)에 맞는 기존 카운터 재사용.
 *  ackAt = 그 매장의 '모두 읽기' 기준 시각(0078, unit_member_prefs — 전 매장 행을 이미 당겨둠). */
export function storeUnreadCount(d: UnitNotifData, role: string, me: string, today: string, ackAt?: string | null): number {
  const nameOf = nameOfFor(d, role, me);
  // ★[미해결 · #14] 직원 매장의 `d.queue`(동료 질문 D4)는 **서버가 아예 안 채운다** —
  //   `my_units_notif_data`(0153)가 `my.role in ('owner','manager')` 인 매장에만 queue 를 준다.
  //   그래서 **매장 안 벨(로컬 unknownQueue 경로)은 "3건"인데 허브 벨은 0건**이다.
  //   여기서 `d.queue` 를 빼도 값은 이미 0이라 **아무것도 안 바뀐다** — 불일치의 원인은 클라가
  //   아니라 서버 술어다. 진짜 수정은 둘 중 하나이고 **제품 결정이 필요하다**:
  //     (a) 0153 술어를 직원까지 열어 허브도 매장 안과 같은 수를 말하게 한다(권고 — 직원은 이미
  //         그 매장 멤버라 매장 안에서 같은 질문을 보고 있으므로 새로운 노출이 아니다), 또는
  //     (b) 매장 안 벨에서도 그 축을 빼서 양쪽 다 0으로 맞춘다.
  //   지금은 (a)를 권고안으로 남기고 코드는 건드리지 않는다 — 값이 안 바뀌는 수정으로
  //   "고쳤다"고 표시하면 다음 사람이 이 불일치를 다시 찾아야 한다.
  if (!canManage(role)) return juniorUnreadCount(d.feed, d.swaps, me, today, d.taskTemplates, d.done, ackAt, d.suggestions, d.queue);
  // 0093: 매니저 매장은 사장 판(질문·제안·합류신청 포함 — RPC 가 manager 매장에도 해당 원천을 준다)
  //       + 매니저가 받는 쪽인 축(공지·배정·내 제안 결과).
  const base = ownerUnreadCount(d.queue, d.suggestions, d.swaps, d.pending, d.feed, me, ackAt);
  return role === 'manager' ? managerUnreadCount(base, receivedArgsOf(d, me, today, nameOf, ackAt)) : base;
}

const nameOfFor = (d: UnitNotifData, role: string, me: string) => (id: string) =>
  id === me ? '나' : d.names[id] || (canManage(role) ? '직원' : '동료');

/** 매장 하나의 알림 목록 — 기존 빌더 재사용(교대 시간표기용 ShiftTemplate 은 cross-store 미제공 → 날짜만). */
export function buildStoreNotifs(d: UnitNotifData, role: string, me: string, today: string, ackAt?: string | null): CrossNotifRow[] {
  const nameOf = nameOfFor(d, role, me);
  const rows: (JuniorNotif | OwnerNotif | ManagerNotif)[] =
    role === 'manager'
      ? buildManagerNotifications(ownerArgsOf(d, me, nameOf, ackAt), receivedArgsOf(d, me, today, nameOf, ackAt))
      : canManage(role)
        ? buildOwnerNotifications(ownerArgsOf(d, me, nameOf, ackAt))
        : buildJuniorNotifications({ feed: d.feed, swaps: d.swaps, templates: [], nameOf, userId: me, today, taskTemplates: d.taskTemplates, done: d.done, ackAt, suggestions: d.suggestions, queue: d.queue });
  return rows.map((r) => ({ ...r, unitId: d.unitId }));
}

/** 전 매장 병합 목록(시간 역순, 단일 매장과 동일 상한). */
export function mergeCrossNotifs(perStore: CrossNotifRow[][]): CrossNotifRow[] {
  return perStore.flat().sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTIFS);
}

/** 자르기 **전** 총 개수 — 배지와 목록이 어긋나는지 화면이 알 수 있게 한다(2026-08-25 감사 #13).
 *  배지는 원본을 세는데 목록은 MAX_NOTIFS 로 잘려, "안 읽음 23"인데 목록엔 없어
 *  **손으로 지울 수 없는 배지**가 남던 경로. 숫자를 낮추는 대신 잘렸다는 사실을 말한다. */
export function crossNotifTotal(perStore: CrossNotifRow[][]): number {
  return perStore.reduce((n, rows) => n + rows.length, 0);
}

/** 매장 하나의 "오늘 내 일" 수 — 나에게 배정됐고 오늘 떠야 하는데 아직 완료 안 한 할일.
 *  술어는 notifications.ts SSOT(isPendingAssignment) 재사용 — 허브 매장 카드 '오늘 할일' 칩·
 *  직원 오늘 탭·허브 탭바 뱃지가 이 하나를 공유한다(카운트 3곳 복제 금지). */
export function assignedTodayCount(d: UnitNotifData, me: string, today: string): number {
  return d.taskTemplates.filter((t) => isPendingAssignment(t, me, today, d.done)).length;
}
