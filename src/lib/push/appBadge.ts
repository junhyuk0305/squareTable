// lib/push/appBadge.ts
// PWA 앱 아이콘 배지(숫자) — 안 읽은 알림 수를 OS 앱 아이콘 위에 표시(실제 앱처럼).
//
// 플랫폼: Badging API(navigator.setAppBadge)는 Android PWA(Chrome/삼성인터넷)·데스크톱 크롬/엣지에서
//   설치(홈화면추가) 시 동작. iOS/사파리는 웹앱 배지를 지원하지 않아 no-op(정책상 불가).
// 역할 분담: 앱이 열려 있는 동안은 이 훅이 '실제 미읽음 수'로 정확히 동기화한다. 앱이 닫혀 있을 때의
//   증가는 서비스워커(public/sw.js)가 알림창에 뜬 알림 수로 배지를 올린다 → 앱을 열면 여기서 재동기화.

import { useEffect, useMemo } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useLegacyQuizOpen } from '@/lib/hooks/useLegacyQuizOpen';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useManageNotifArgs } from '@/lib/hooks/useManageNotifArgs';
import { useToday } from '@/lib/hooks/useToday';
import { ackOfUnit, joinNoticesOfUnit, juniorUnreadCount, manageUnreadCount } from '@/lib/utils/notifications';
import { useCrossNotifModel } from '@/lib/hooks/useCrossNotifRows';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { setNativeBadge } from '@/lib/push/nativepush';
import { canManage } from '@/lib/utils/roles';

const EMPTY_IDS: string[] = [];

type BadgeNav = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

// 서비스워커(public/sw.js)와 '실제 안 읽은 수'를 공유하는 IndexedDB 키.
// 앱이 열려 있을 땐 여기(useAppBadgeSync)가 실수치를 기록하고, 앱이 닫혀 푸시가 오면 SW가 그 값을 +1 해 올린다.
// → 방해금지(푸시 억제)로 알림창이 비어도, 껐다 켠 뒤 배지가 1이 아니라 누적수부터 이어진다.
//   (예전엔 SW가 '알림창에 떠 있는 수'로 배지를 잡아 tag 접힘·방해금지 공백에 1로 튀었다.)
const BADGE_DB = 'chakchak-badge';
const BADGE_STORE = 'kv';
const BADGE_KEY = 'count';

/** 실제 안 읽은 수를 IDB에 저장(앱이 닫힌 뒤 SW가 여기서 이어 증가). 실패해도 무해(배지만 덜 정확). */
function persistBadgeCount(count: number): void {
  try {
    if (typeof indexedDB === 'undefined') return;
    const req = indexedDB.open(BADGE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BADGE_STORE)) db.createObjectStore(BADGE_STORE);
    };
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction(BADGE_STORE, 'readwrite');
        tx.objectStore(BADGE_STORE).put(count, BADGE_KEY);
      } catch {
        /* 무시 */
      }
    };
  } catch {
    /* 미지원 — 무시 */
  }
}

/** 앱 아이콘 배지를 count로 설정(0이면 지움). 미지원 플랫폼(iOS 등)은 조용히 no-op.
 *  동시에 SW 공유 카운터(IDB)에도 실수치를 기록해, 앱이 닫힌 뒤의 증가가 '누적수'에서 이어지게 한다. */
export function setAppBadge(count: number): void {
  setNativeBadge(count); // 안드·iOS 앱 아이콘(웹에서는 아무것도 안 한다)
  persistBadgeCount(count);
  if (typeof navigator === 'undefined') return;
  const n = navigator as BadgeNav;
  try {
    if (count > 0) {
      if (n.setAppBadge) void n.setAppBadge(count).catch(() => {});
    } else if (n.clearAppBadge) {
      void n.clearAppBadge().catch(() => {});
    }
  } catch {
    /* 미지원 — 무시 */
  }
}

/**
 * 앱이 열려 있는 동안 앱 아이콘 배지 = 허브 알림 숫자(2026-11-16 사용자 결정 · R-13 · "항상 같은 것").
 * 허브가 맨 위다: 내 모든 자리(매장·공간)의 안 읽은 줄 합 = useCrossNotifModel().totalUnread(허브 벨과 같은 값).
 * 매장 안에서 줄이 바뀌면(실시간 · 한 줄 읽음) 그 매장 벨 숫자가 먼저 바뀐다 → 그때 허브 모형을 다시 당겨 배지가 따라온다.
 * _layout에서 1회 마운트.
 */
export function useAppBadgeSync(): void {
  const role = useSessionStore((s) => s.role);
  const me = useSessionStore((s) => s.userId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  const unitId = useSessionStore((s) => s.unitId);
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));
  const ackByUnit = useMemberPrefsStore((s) => s.ackByUnit);

  // 매장 벨 숫자(변화 감지용 · 배지 값이 아니다) — 벨(NotificationBell)과 같은 입력·같은 함수.
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const assignments = useWorkStore((s) => s.assignments);
  const quizProgressRaw = useWorkStore((s) => s.quizProgress);
  const quizProgressError = useWorkStore((s) => s.quizProgressError);
  const quizProgress = quizProgressError ? undefined : quizProgressRaw;
  const courses = useWorkStore((s) => s.courses);
  const legacyQuizIds = useLegacyQuizOpen().ids ?? EMPTY_IDS;
  const swaps = useScheduleStore((s) => s.swaps);
  const scheduleNotices = useScheduleStore((s) => s.notices);
  const joinNotices = useStaffStore((s) => s.joinNotices);
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const manage = useManageNotifArgs();
  const today = useToday();
  const storeCount = useMemo(() => {
    if (!signedIn || !me || !unitId) return 0;
    return canManage(role)
      ? manageUnreadCount(role, manage.ownerArgs, manage.received)
      : juniorUnreadCount(feed, swaps, me, today, templates, done, ackAt, suggestions, queue, scheduleNotices, assignments, joinNoticesOfUnit(joinNotices, unitId), ackOfUnit(ackByUnit), quizProgress, courses, legacyQuizIds);
  }, [signedIn, me, unitId, role, manage, feed, swaps, today, templates, done, ackAt, suggestions, queue, scheduleNotices, assignments, joinNotices, ackByUnit, quizProgress, courses, legacyQuizIds]);

  const { totalUnread } = useCrossNotifModel();
  const crossLoaded = useCrossNotifStore((s) => s.loaded);

  // 매장 안 변화 → 허브 모형 다시 읽기(1.5초 모아서 한 번 · 로그인 직후 첫 읽기도 이 길).
  useEffect(() => {
    if (!signedIn || !me) return;
    const t = setTimeout(() => void useCrossNotifStore.getState().retry(), 1_500);
    return () => clearTimeout(t);
  }, [signedIn, me, storeCount]);

  useEffect(() => {
    if (!signedIn || !me) {
      setAppBadge(0);
      return;
    }
    if (!crossLoaded) return; // 못 읽은 상태를 0 으로 그리지 않는다
    setAppBadge(totalUnread);
  }, [signedIn, me, crossLoaded, totalUnread]);
}
