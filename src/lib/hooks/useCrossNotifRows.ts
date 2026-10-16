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
import { accountAckAt } from '@/lib/utils/notifications';
import { storeColor } from '@/lib/utils/storeColor';
import { todayStr } from '@/lib/utils/attendance';
import type { NotifRow } from '@/components/NotificationList';

export function useCrossNotifRows() {
  const router = useRouter();
  const me = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const sessionStores = useSessionStore((s) => s.stores);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const crossData = useCrossNotifStore((s) => s.data);
  const closures = useCrossNotifStore((s) => s.closures);
  const joinNotices = useCrossNotifStore((s) => s.joinNotices);
  const markFeedRead = useCrossNotifStore((s) => s.markFeedRead);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const ackNotifs = useMemberPrefsStore((s) => s.ackNotifs);
  const [switching, setSwitching] = useState(false);

  const today = todayStr();
  // 매장 표시명 — 닉네임(unit_member_prefs) 우선, sessionStores(my_units)가 원본명 SSOT.
  //   목록에 없는 매장(반려된 합류 신청 매장)은 행이 가진 이름(member_notices.store_name)으로.
  const labelOf = (uid: string, fallback?: string) =>
    prefFor(uid).nickname || sessionStores.find((u) => u.unit_id === uid)?.store_name || fallback || '매장';

  const ackByUnit = useMemberPrefsStore((s) => s.ackByUnit);
  const { rows, unreadByUnit, totalUnread, hiddenCount } = useMemo(() => {
    // 매장 목록(my_units) 도착 전엔 계산하지 않는다 — 매장별 역할을 모른 채 전역 role 로 세면
    // 찰나에 틀린 뱃지가 떴다 바뀌는 레이스가 생긴다. 목록이 오면(수 초 내) 자동 재계산돼 표시.
    if (sessionStores.length === 0) {
      return { rows: mergeCrossNotifs([]), unreadByUnit: {} as Record<string, number>, totalUnread: 0, hiddenCount: 0 };
    }
    // 목록에 없는 매장은 직원 기준으로 센다(fail-closed) — 다른 매장의 역할을 빌려 쓰지 않는다.
    const rOf = (uid: string) => sessionStores.find((u) => u.unit_id === uid)?.role ?? 'junior';
    const ackOf = (uid: string) => ackByUnit[uid] ?? null; // 매장별 '모두 읽기' 기준(0078)
    const unreadByUnit: Record<string, number> = {};
    for (const d of crossData) unreadByUnit[d.unitId] = storeUnreadCount(d, rOf(d.unitId), me, today, ackOf(d.unitId));
    const perStore = crossData.map((d) => buildStoreNotifs(d, rOf(d.unitId), me, today, ackOf(d.unitId)));
    // 닫힌 매장 알림(0197) — 매장별 행에 얹는다. 카운트도 같은 행을 센다(배지·목록 같은 입력).
    const closureRows = buildClosureNotifs(closures, ackOf);
    for (const r of closureRows) if (r.unread) unreadByUnit[r.unitId] = (unreadByUnit[r.unitId] ?? 0) + 1;
    perStore.push(closureRows);
    // 합류 결과(0247 · 계정 단위 · 0313) — 읽음 기준은 내 매장 ack 중 가장 늦은 시각(accountAckAt · 매장 벨과 같은 판정).
    const joinRows = buildJoinCrossNotifs(joinNotices, accountAckAt(ackByUnit));
    for (const r of joinRows) if (r.unread) unreadByUnit[r.unitId] = (unreadByUnit[r.unitId] ?? 0) + 1;
    perStore.push(joinRows);
    const merged = mergeCrossNotifs(perStore);
    return {
      rows: merged,
      unreadByUnit,
      totalUnread: Object.values(unreadByUnit).reduce((a, b) => a + b, 0),
      // 목록에서 잘려나간 개수 — 0 이 아니면 화면이 "N건 더 있어요"를 말해야 한다(#13).
      hiddenCount: Math.max(0, crossNotifTotal(perStore) - merged.length),
    };
  }, [crossData, closures, joinNotices, sessionStores, me, today, ackByUnit]);

  /** NotificationList 에 바로 넣을 행(매장 점·이름 칩 포함). */
  const listRows: (NotifRow & { unitId: string })[] = rows.map((r) => ({
    ...r,
    storeLabel: labelOf(r.unitId, r.storeName),
    storeColor: storeColor(r.unitId, prefFor(r.unitId).color),
  }));

  // 허브 '모두 읽기'(10-16 결정 3) — 내 매장 전부를 ack 한다(매장 벨과 같은 함수 ackNotifs · 0078 멤버십 가드).
  //   어디서 읽어도 읽은 것이다: 매장 벨은 그 매장 ack 하나, 허브는 전부. 합류 결과는 accountAckAt(최대값)이라 같이 지워진다.
  //   멘션 read_by 는 매장 벨 '모두 읽기'와 같은 길(0176 한 문장 RPC · 활성 매장만 — 다른 매장 행은 RLS 밖이라 ack 시각이 강조를 지운다).
  const hasUnread = rows.some((r) => r.unread);
  const markAll = () => {
    if (!hasUnread) return;
    const feedIds = rows
      .filter((r) => r.unread && r.unitId === unitId && r.kind !== 'closure' && r.readFeedId)
      .map((r) => (r as { readFeedId?: string }).readFeedId as string);
    if (feedIds.length > 0) {
      const work = useWorkStore.getState();
      const inWork = feedIds.filter((id) => work.feed.some((f) => f.id === id));
      if (inWork.length > 0) work.markAllRead(inWork, me);
      // 허브 직진입(매장 레이어 미하이드레이트)이면 행별 RPC. 어느 쪽이든 허브 목록은 로컬로 맞춘다.
      for (const id of feedIds) void markFeedRead(unitId, id, me, !inWork.includes(id));
    }
    for (const s of sessionStores) void ackNotifs(s.unit_id);
    showToast('모두 읽음 처리했어요', 'good');
  };

  // 행 탭 = (다른 매장이면) 활성 전환 후 이동. 읽음처리 규칙:
  //  - 크로스 행: 전환 완료 후 직접 DB 기록(wf_update RLS = 활성 매장 스코프라 전환 전엔 불가).
  //  - 활성 행: workStore 에 있으면 기존 경로(markNoticeRead=로컬+DB), 없으면(허브 직진입 등
  //    매장 레이어 미하이드레이트 — 훅이 이 경계 참조를 한 곳에 캡슐화) 직접 DB.
  const openRow = async (r: NotifRow) => {
    const row = r as NotifRow & { unitId?: string };
    if (switching || !row.unitId) return;
    // 닫힌 매장 알림 — 들어갈 매장이 없다(전환하면 unit_locked). 다음 행동은 문구가 말한다.
    if (row.kind === 'closure') {
      showToast(row.body ?? '사장님께 문의해 주세요.');
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

  // 반환 = 소비처(4화면)가 실제 쓰는 것만(죽은 export 금지 — 2026-07-24 효율 리뷰). hasUnread·markAll 은 허브 알림 화면.
  return { listRows, unreadByUnit, totalUnread, hiddenCount, openRow, hasUnread, markAll };
}
