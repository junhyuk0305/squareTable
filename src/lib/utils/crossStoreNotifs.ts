// 통합 알림(cross-store) 파생 — 판정·목록 구성은 notifications.ts SSOT 를 매장별로 재사용한다.
// 여기서 새 술어를 만들지 않는다(§②). 입력은 db.fetchCrossStoreNotifData(0077 RPC)의 매장별 원시 묶음.
import type { UnitNotifData } from '@/lib/db';
import type { JoinNotice } from '@/lib/store/useStaffStore';
import {
  buildJoinNotifRows,
  buildJuniorNotifications,
  buildManagerNotifications,
  buildOwnerNotifications,
  isPendingAssignment,
  isAfterAck,
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

/** 닫힌 매장 알림(0196·0197) — 매장이 닫혀 들어갈 곳이 없으므로 route 가 없다(탭 = 문구만). */
export type ClosureNotif = { id: string; kind: 'closure'; title: string; body: string; at: string; unread: boolean };

/** 통합 리스트 한 행 = 기존 알림 행 + 어느 매장 것인지(unitId). 매장명·색 표시는 화면이 붙인다.
 *  storeName = 내 매장 목록에 없는 매장의 이름(반려된 합류 신청 매장) — 화면이 칩 폴백으로 쓴다. */
export type CrossNotifRow = (JuniorNotif | OwnerNotif | ManagerNotif | ClosureNotif) & { unitId: string; storeName?: string };

/** 합류 결과(0247 · 계정 단위) → 허브 행. 행 빌더·읽음 판정은 매장 벨과 같은 것(buildJoinNotifRows · accountAckAt).
 *  unitId = 그 알림의 매장(반려된 매장은 내 매장 목록에 없다 → storeName 으로 칩을 그린다). */
export function buildJoinCrossNotifs(joinNotices: JoinNotice[], joinAckAt: string | null): CrossNotifRow[] {
  const byId = new Map(joinNotices.map((n) => [`${n.kind === 'approved' ? 'join_approved' : 'join_rejected'}_${n.id}`, n]));
  return buildJoinNotifRows(joinNotices, joinAckAt).map((r) => {
    const n = byId.get(r.id);
    return { ...r, unitId: n?.unit_id ?? '', storeName: n?.store_name ?? undefined };
  });
}

/** 닫힘 원장 행 → 알림 행. 읽음 축은 처리형 항목과 같은 '모두 읽기' 시각(0078)뿐이다. */
export function buildClosureNotifs(
  rows: { id: number; unit_id: string; title: string; body: string; created_at: string }[],
  ackOf: (uid: string) => string | null | undefined,
): CrossNotifRow[] {
  return rows.map((r) => ({
    id: `closure-${r.id}`, kind: 'closure' as const, title: r.title, body: r.body, at: r.created_at,
    unread: isAfterAck(r.created_at, ackOf(r.unit_id)), unitId: r.unit_id,
  }));
}

// 매장 하나에서 쓸 인자 묶음 — 카운트와 목록이 **같은 입력**을 보게 한 곳에서 만든다.
//   0313: 입금 결과·사장 알림·퀴즈 완료·시간 수정 요청도 벨과 같은 자리에(매장 벨 owner/notifications.tsx ownerArgs 와 같은 키).
const ownerArgsOf = (d: UnitNotifData, me: string, nameOf: (id: string) => string, ackAt?: string | null) =>
  ({ queue: d.queue, suggestions: d.suggestions, swaps: d.swaps, pending: d.pending, nameOf, feed: d.feed, userId: me, ackAt,
     claims: d.claims, alerts: d.alerts, assignments: d.assignments, courses: d.courses, timeRequests: d.timeRequests });
const receivedArgsOf = (
  d: UnitNotifData, me: string, today: string, nameOf: (id: string) => string, ackAt?: string | null,
): ManagerReceivedArgs =>
  ({ feed: d.feed, taskTemplates: d.taskTemplates, done: d.done, today, suggestions: d.suggestions, userId: me, nameOf, ackAt });

/** 매장 하나의 안읽음 카운트 — 그 매장에서의 역할(unit_members.role)에 맞는 기존 카운터 재사용.
 *  ackAt = 그 매장의 '모두 읽기' 기준 시각(0078, unit_member_prefs — 전 매장 행을 이미 당겨둠). */
export function storeUnreadCount(d: UnitNotifData, role: string, me: string, today: string, ackAt?: string | null): number {
  const nameOf = nameOfFor(d, role, me);
  // 직원 매장의 d.queue(동료 질문 D4 · 내 질문에 온 답)는 0313 부터 서버가 채운다(#14 (a) 채택 · 매장 안 벨과 같은 수).
  //   합류 결과(계정 단위)는 여기서 세지 않는다 — buildJoinCrossNotifs 행을 훅이 따로 센다.
  if (!canManage(role)) return juniorUnreadCount(d.feed, d.swaps, me, today, d.taskTemplates, d.done, ackAt, d.suggestions, d.queue, d.scheduleNotices, d.assignments);
  // 0093: 매니저 매장 = 사장 축 중 매니저가 행동할 수 있는 것 + 매니저가 받는 쪽인 축(공지·배정·내 제안 결과).
  //       목록(buildStoreNotifs)과 같은 인자·같은 배열에서 센다(F-2).
  if (role === 'manager') return managerUnreadCount(ownerArgsOf(d, me, nameOf, ackAt), receivedArgsOf(d, me, today, nameOf, ackAt));
  // 사장도 나에게 온 공지·배정을 센다(D11) — 목록(buildStoreNotifs)과 같은 인자(0313: 입금 결과·사장 알림·퀴즈 완료·시간 수정 요청).
  return ownerUnreadCount(d.queue, d.suggestions, d.swaps, d.pending, d.feed, me, ackAt, d.claims, d.alerts, receivedArgsOf(d, me, today, nameOf, ackAt), d.assignments, d.timeRequests);
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
        ? buildOwnerNotifications(ownerArgsOf(d, me, nameOf, ackAt), receivedArgsOf(d, me, today, nameOf, ackAt))
        : buildJuniorNotifications({ feed: d.feed, swaps: d.swaps, templates: [], nameOf, userId: me, today, taskTemplates: d.taskTemplates, done: d.done, ackAt, suggestions: d.suggestions, queue: d.queue,
            scheduleNotices: d.scheduleNotices, assignments: d.assignments, courses: d.courses });
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
