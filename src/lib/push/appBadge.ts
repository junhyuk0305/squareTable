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
import { todayStr } from '@/lib/utils/attendance';
import { juniorUnreadCount, ownerUnreadCount } from '@/lib/utils/notifications';

type BadgeNav = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** 앱 아이콘 배지를 count로 설정(0이면 지움). 미지원 플랫폼(iOS 등)은 조용히 no-op. */
export function setAppBadge(count: number): void {
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

  // 직원 집계 입력
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const swaps = useScheduleStore((s) => s.swaps);
  // 사장 집계 입력
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const pending = useStaffStore((s) => s.pending);

  const today = todayStr();

  useEffect(() => {
    if (!signedIn || !me) {
      setAppBadge(0);
      return;
    }
    const count =
      role === 'owner'
        ? ownerUnreadCount(queue, suggestions, swaps, pending, feed, me)
        : juniorUnreadCount(feed, swaps, me, today, templates, done);
    setAppBadge(count);
  }, [role, me, signedIn, feed, templates, done, swaps, queue, suggestions, pending, today]);
}
