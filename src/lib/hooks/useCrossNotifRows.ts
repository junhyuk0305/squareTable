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
import { buildStoreNotifs, mergeCrossNotifs, storeUnreadCount, type CrossNotifRow } from '@/lib/utils/crossStoreNotifs';
import { storeColor } from '@/lib/utils/storeColor';
import { todayStr } from '@/lib/utils/attendance';
import type { NotifRow } from '@/components/NotificationList';

export function useCrossNotifRows() {
  const router = useRouter();
  const me = useSessionStore((s) => s.userId);
  const role = useSessionStore((s) => s.role);
  const unitId = useSessionStore((s) => s.unitId);
  const sessionStores = useSessionStore((s) => s.stores);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const crossData = useCrossNotifStore((s) => s.data);
  const markFeedRead = useCrossNotifStore((s) => s.markFeedRead);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const [switching, setSwitching] = useState(false);

  const today = todayStr();
  // 매장별 역할/표시명 — sessionStores(my_units) 가 SSOT. 미로드 시 전역 role 폴백(재렌더로 자기교정).
  const roleOf = (uid: string) => sessionStores.find((u) => u.unit_id === uid)?.role ?? role;
  const labelOf = (uid: string) =>
    prefFor(uid).nickname || sessionStores.find((u) => u.unit_id === uid)?.store_name || '매장';

  const { rows, unreadByUnit, totalUnread } = useMemo(() => {
    const rOf = (uid: string) => sessionStores.find((u) => u.unit_id === uid)?.role ?? role;
    const unreadByUnit: Record<string, number> = {};
    for (const d of crossData) unreadByUnit[d.unitId] = storeUnreadCount(d, rOf(d.unitId), me, today);
    return {
      rows: mergeCrossNotifs(crossData.map((d) => buildStoreNotifs(d, rOf(d.unitId), me, today))),
      unreadByUnit,
      totalUnread: Object.values(unreadByUnit).reduce((a, b) => a + b, 0),
    };
  }, [crossData, sessionStores, role, me, today]);

  /** NotificationList 에 바로 넣을 행(매장 점·이름 칩 포함). */
  const listRows: (NotifRow & { unitId: string })[] = rows.map((r) => ({
    ...r,
    storeLabel: labelOf(r.unitId),
    storeColor: storeColor(r.unitId, prefFor(r.unitId).color),
  }));

  // 행 탭 = (다른 매장이면) 활성 전환 후 이동. 읽음처리 규칙:
  //  - 크로스 행: 전환 완료 후 직접 DB 기록(wf_update RLS = 활성 매장 스코프라 전환 전엔 불가).
  //  - 활성 행: workStore 에 있으면 기존 경로(markNoticeRead=로컬+DB), 없으면(허브 직진입 등
  //    매장 레이어 미하이드레이트 — 훅이 이 경계 참조를 한 곳에 캡슐화) 직접 DB.
  const openRow = async (r: NotifRow) => {
    const row = r as NotifRow & { unitId?: string };
    if (switching || !row.unitId) return;
    if (row.unitId !== unitId) {
      setSwitching(true);
      await switchUnit(row.unitId);
      setSwitching(false);
      if (row.readFeedId) void markFeedRead(row.unitId, row.readFeedId, me);
    } else if (row.readFeedId) {
      const inWork = !!useWorkStore.getState().feed.find((f) => f.id === row.readFeedId);
      if (inWork) useWorkStore.getState().markNoticeRead(row.readFeedId, me);
      void markFeedRead(row.unitId, row.readFeedId, me, !inWork);
    }
    if (row.route) router.push(row.route as Href);
  };

  return { rows, listRows, unreadByUnit, totalUnread, labelOf, roleOf, openRow, switching };
}

export type { CrossNotifRow };
