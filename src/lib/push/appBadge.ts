// lib/push/appBadge.ts
// PWA 앱 아이콘 배지(숫자) — 안 읽은 알림 수를 OS 앱 아이콘 위에 표시(실제 앱처럼).
//
// 플랫폼: Badging API(navigator.setAppBadge)는 Android PWA(Chrome/삼성인터넷)·데스크톱 크롬/엣지에서
//   설치(홈화면추가) 시 동작. iOS/사파리는 웹앱 배지를 지원하지 않아 no-op(정책상 불가).
// 역할 분담: 앱이 열려 있는 동안은 이 훅이 '실제 미읽음 수'로 정확히 동기화한다. 앱이 닫혀 있을 때의
//   증가는 서비스워커(public/sw.js)가 알림창에 뜬 알림 수로 배지를 올린다 → 앱을 열면 여기서 재동기화.

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { usePaymentClaimStore } from '@/lib/store/usePaymentClaimStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { todayStr } from '@/lib/utils/attendance';
import { juniorUnreadCount, ownerUnreadCount } from '@/lib/utils/notifications';

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
 * 앱이 열려 있는 동안 안 읽은 알림 수를 앱 아이콘 배지에 실시간 동기화(역할별).
 * _layout에서 1회 마운트. 벨 배지(NotificationBell)와 같은 SSOT 집계를 재사용한다.
 */
export function useAppBadgeSync(): void {
  const role = useSessionStore((s) => s.role);
  const me = useSessionStore((s) => s.userId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  const unitId = useSessionStore((s) => s.unitId);
  // '모두 읽기'(0078) 기준 시각 — 벨 배지와 동일 SSOT 집계 유지.
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));

  // 직원 집계 입력
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const swaps = useScheduleStore((s) => s.swaps);
  // 사장 집계 입력
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const pending = useStaffStore((s) => s.pending);
  const claims = usePaymentClaimStore((s) => s.claims);

  const today = todayStr();

  useEffect(() => {
    if (!signedIn || !me) {
      setAppBadge(0);
      return;
    }
    const count =
      role === 'owner'
        ? ownerUnreadCount(queue, suggestions, swaps, pending, feed, me, ackAt, claims)
        : juniorUnreadCount(feed, swaps, me, today, templates, done, ackAt, suggestions);
    setAppBadge(count);
  }, [role, me, signedIn, feed, templates, done, swaps, queue, suggestions, pending, today, ackAt, claims]);
}
