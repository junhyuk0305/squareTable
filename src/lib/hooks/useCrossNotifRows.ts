// 통합 알림(cross-store) 화면 공용 훅 — stores 허브·junior/owner 알림 화면 3곳이 소비한다.
// 왜 훅인가(2레이어 감사 F1): roleOf/labelOf/행 매핑/합산/탭 동작이 3화면에 인라인 3중 복제돼
// 이미 미세 드리프트(라벨 소스·route 가드 유무)가 났다 → 판정·매핑·탭 동작을 여기 한 곳으로 수렴(§SSOT).
// 순수 파생(비-React)은 crossStoreNotifs.ts 에 그대로 두고, 여기선 스토어 셀렉터 조합 + 탭 동작만 묶는다
// (useOwnerDashboardData/useJuniorHomeData 와 동일한 화면 데이터 훅 패턴).
import { useMemo, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { showToast } from '@/lib/store/useToastStore';
import { buildStoreNotifs, buildClosureNotifs, buildJoinCrossNotifs, mergeCrossNotifs, crossNotifTotal, storeUnreadCount } from '@/lib/utils/crossStoreNotifs';
import { ackOfUnit, notifRowKey } from '@/lib/utils/notifications';
import { buildSpaceNotifRows } from '@/lib/utils/spaceNotifications';
import { storeColor } from '@/lib/utils/storeColor';
import { todayStr } from '@/lib/utils/attendance';
import type { NotifRow } from '@/components/NotificationList';

/** 공간 자리의 줄(공간 합류 요청·수락) — '전체 매장' 탭은 매장 줄만 보인다. 공간 줄은 허브가 보인다. */
const isSpaceKind = (kind: string) => kind.startsWith('space_');

/**
 * 허브(계정 층) 알림 모형 — 줄·안 읽음 수·자리 목록. 라우터를 쓰지 않아 앱 배지(appBadge)도 같은 값을 쓴다.
 * 허브가 맨 위다(2026-11-16 사용자 결정): 허브 숫자 = 앱 배지 = 내 모든 자리(매장·공간)의 안 읽은 줄 합.
 * 읽음 판정 = 줄 자리의 읽은 시각(ackOfUnit · notifications.ts). 다른 자리 시각을 빌리지 않는다.
 */
export function useCrossNotifModel() {
  const me = useSessionStore((s) => s.userId);
  const sessionStores = useSessionStore((s) => s.stores);
  const crossData = useCrossNotifStore((s) => s.data);
  const closures = useCrossNotifStore((s) => s.closures);
  const joinNotices = useCrossNotifStore((s) => s.joinNotices);
  const spaceRaw = useCrossNotifStore((s) => s.spaceRows);
  const today = todayStr();

  const ackByUnit = useMemberPrefsStore((s) => s.ackByUnit);
  const ackOf = useMemo(() => ackOfUnit(ackByUnit), [ackByUnit]);
  const rowRead = useMemberPrefsStore((s) => s.rowRead); // 눌러 본 줄(0811)
  // 공간 줄(야간 g4a · my_space_notif_data) — 계정 층 벨 목록과 허브 벨 숫자가 이 배열 하나를 본다(1112 fix 16).
  //   매장별 칩(unreadByUnit)에는 넣지 않는다. 공간은 매장 층 밖이다. 읽음 기준 = 그 공간의 읽은 시각.
  const spaceRows = useMemo(() => buildSpaceNotifRows(spaceRaw, ackOf, rowRead), [spaceRaw, ackOf, rowRead]);
  const spaceUnread = spaceRows.filter((r) => r.unread).length;
  const { rows, unreadByUnit, totalUnread, hiddenCount } = useMemo(() => {
    // 매장 목록(my_units) 도착 전엔 계산하지 않는다 — 매장별 역할을 모른 채 전역 role 로 세면
    // 찰나에 틀린 뱃지가 떴다 바뀌는 레이스가 생긴다. 목록이 오면(수 초 내) 자동 재계산돼 표시.
    if (sessionStores.length === 0) {
      // 계정 단위 축(합류 결과 · 공간 멤버 요청과 수락)은 역할을 안 본다 → 매장이 없는 계정(공간만 쓰는 사람)에게도 그린다(4번 덩이).
      const joinOnly = buildJoinCrossNotifs(joinNotices, ackOf, rowRead);
      const unreadOnly: Record<string, number> = {};
      for (const r of joinOnly) if (r.unread) unreadOnly[r.unitId] = (unreadOnly[r.unitId] ?? 0) + 1;
      return {
        rows: mergeCrossNotifs([joinOnly]), unreadByUnit: unreadOnly,
        totalUnread: Object.values(unreadOnly).reduce((a, b) => a + b, 0) + spaceUnread, hiddenCount: 0,
      };
    }
    // 목록에 없는 매장은 직원 기준으로 센다(fail-closed) — 다른 매장의 역할을 빌려 쓰지 않는다.
    const rOf = (uid: string) => sessionStores.find((u) => u.unit_id === uid)?.role ?? 'junior';
    const unreadByUnit: Record<string, number> = {};
    for (const d of crossData) unreadByUnit[d.unitId] = storeUnreadCount(d, rOf(d.unitId), me, today, ackOf(d.unitId), rowRead);
    const perStore = crossData.map((d) => buildStoreNotifs(d, rOf(d.unitId), me, today, ackOf(d.unitId), rowRead));
    // 닫힌 매장 알림(0197) — 매장별 행에 얹는다. 카운트도 같은 행을 센다(배지·목록 같은 입력).
    const closureRows = buildClosureNotifs(closures, ackOf, rowRead);
    for (const r of closureRows) if (r.unread) unreadByUnit[r.unitId] = (unreadByUnit[r.unitId] ?? 0) + 1;
    perStore.push(closureRows);
    // 합류 결과(0247 · 0313) — 읽음 기준은 그 줄 자리의 읽은 시각(매장 벨과 같은 판정).
    const joinRows = buildJoinCrossNotifs(joinNotices, ackOf, rowRead);
    for (const r of joinRows) if (r.unread) unreadByUnit[r.unitId] = (unreadByUnit[r.unitId] ?? 0) + 1;
    perStore.push(joinRows);
    const merged = mergeCrossNotifs(perStore);
    return {
      rows: merged,
      unreadByUnit,
      totalUnread: Object.values(unreadByUnit).reduce((a, b) => a + b, 0) + spaceUnread,
      // 목록에서 잘려나간 개수 — 0 이 아니면 화면이 "N건 더 있어요"를 말해야 한다(#13).
      hiddenCount: Math.max(0, crossNotifTotal(perStore) - merged.length),
    };
  }, [crossData, closures, joinNotices, sessionStores, me, today, ackOf, rowRead, spaceUnread]);

  // 허브가 담는 자리 전부 — 허브 전체 읽음은 이 자리를 모두 읽음으로 한다(목록 상한에 잘린 줄의 자리도 포함).
  const hubUnitIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessionStores) ids.add(s.unit_id);
    for (const d of crossData) ids.add(d.unitId);
    for (const c of closures) ids.add(c.unit_id);
    for (const n of joinNotices) if (n.unit_id) ids.add(n.unit_id);
    for (const r of spaceRaw) if (r.unitId) ids.add(r.unitId);
    return [...ids];
  }, [sessionStores, crossData, closures, joinNotices, spaceRaw]);

  return { rows, spaceRows, unreadByUnit, totalUnread, hiddenCount, hubUnitIds };
}

export function useCrossNotifRows() {
  const router = useRouter();
  const me = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const sessionStores = useSessionStore((s) => s.stores);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const markFeedRead = useCrossNotifStore((s) => s.markFeedRead);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const markAllSeen = useMemberPrefsStore((s) => s.markAllSeen);
  const markRowRead = useMemberPrefsStore((s) => s.markRowRead);
  const [switching, setSwitching] = useState(false);
  const { rows, spaceRows, unreadByUnit, totalUnread, hiddenCount, hubUnitIds } = useCrossNotifModel();

  // 매장 표시명 — 닉네임(unit_member_prefs) 우선, sessionStores(my_units)가 원본명 SSOT.
  //   목록에 없는 매장(반려된 합류 신청 매장)은 행이 가진 이름(member_notices.store_name)으로.
  const labelOf = (uid: string, fallback?: string) =>
    prefFor(uid).nickname || sessionStores.find((u) => u.unit_id === uid)?.store_name || fallback || '매장';

  /** NotificationList 에 바로 넣을 행(매장 점·이름 칩 포함). */
  const listRows: (NotifRow & { unitId: string })[] = rows.map((r) => ({
    ...r,
    storeLabel: labelOf(r.unitId, r.storeName),
    storeColor: storeColor(r.unitId, prefFor(r.unitId).color),
  }));

  // '전체 매장' 탭(사장·직원 알림) = 매장 자리 줄만. 공간 줄은 허브가 보인다 — 탭 숫자도 이 줄만 센다(목록과 같은 입력).
  const storeRows = listRows.filter((r) => !isSpaceKind(r.kind));
  const storeUnread = storeRows.filter((r) => r.unread).length;
  const hasUnread = rows.some((r) => r.unread) || spaceRows.some((r) => r.unread);

  // 전체 읽음(2026-11-16 · 0810) — 쓰기는 markAllSeen 하나. 허브가 맨 위다.
  //   'hub'    = 허브 화면: 내 모든 자리(매장·공간·멤버가 아닌 자리) → 매장 안 화면에서도 읽은 것이다.
  //   'stores' = '전체 매장' 탭: 그 탭에 보이는 매장 자리 전부(공간 자리는 건드리지 않는다).
  //   공지·멘션 read_by 는 같은 호출에서 서버가 자리마다 멤버십·방 권한을 보고 쓴다(다른 매장 줄도).
  const markAll = (scope: 'hub' | 'stores') => {
    const shown = scope === 'hub' ? rows : storeRows;
    const unitIds = scope === 'hub'
      ? hubUnitIds
      : [...new Set([...sessionStores.map((s) => s.unit_id), ...storeRows.map((r) => r.unitId)])];
    const feedIds = shown
      .map((r) => (r.unread ? (r as { readFeedId?: string }).readFeedId : undefined))
      .filter((id): id is string => !!id);
    return markAllSeen(unitIds, feedIds);
  };

  // 행 탭 = (다른 매장이면) 활성 전환 후 이동. 읽음처리 규칙:
  //  - 크로스 행: 전환 완료 후 직접 DB 기록(wf_update RLS = 활성 매장 스코프라 전환 전엔 불가).
  //  - 활성 행: workStore 에 있으면 기존 경로(markNoticeRead=로컬+DB), 없으면(허브 직진입 등
  //    매장 레이어 미하이드레이트 — 훅이 이 경계 참조를 한 곳에 캡슐화) 직접 DB.
  const openRow = async (r: NotifRow) => {
    const row = r as NotifRow & { unitId?: string };
    if (switching || !row.unitId) return;
    markRowRead(notifRowKey(row)); // 눌러서 들어가면 그 줄은 읽음(모든 종류 · 0811 · 닫힌 매장 안내도)
    // 닫힌 매장 알림 — 들어갈 매장이 없다(전환하면 unit_locked). 다음 행동은 문구가 말한다.
    if (row.kind === 'closure') {
      showToast(row.body ?? '사장님께 문의해 주세요.');
      return;
    }
    // 공간 행(0460 · N7·N8) — 매장 전환을 하지 않는다(서버가 공간 전환을 거절한다). 공간 _layout 이 경로의 공간에 먼저 들어간다.
    if (row.route?.startsWith('/space/')) {
      router.push(row.route as Href);
      return;
    }
    if (row.unitId !== unitId) {
      setSwitching(true);
      const { error } = await switchUnit(row.unitId);
      setSwitching(false);
      // 전환 실패 시 이동하지 않는다 — 이전 매장 화면을 "그 매장인 줄 알고" 보게 되는 무음 오류 방지.
      if (error) {
        showToast(error, 'warn');
        return;
      }
      if (row.readFeedId) void markFeedRead(row.unitId, row.readFeedId, me);
    } else if (row.readFeedId) {
      const inWork = !!useWorkStore.getState().feed.find((f) => f.id === row.readFeedId);
      if (inWork) useWorkStore.getState().markNoticeRead(row.readFeedId, me);
      void markFeedRead(row.unitId, row.readFeedId, me, !inWork);
    }
    if (row.route) router.push(row.route as Href);
  };

  // 반환 = 소비처(4화면)가 실제 쓰는 것만(죽은 export 금지 — 2026-07-24 효율 리뷰).
  //   hasUnread·markAll('hub') = 허브 알림 화면 · storeRows·storeUnread·markAll('stores') = 사장·직원 '전체 매장' 탭.
  return { listRows, spaceRows, storeRows, storeUnread, unreadByUnit, totalUnread, hiddenCount, openRow, hasUnread, markAll };
}
