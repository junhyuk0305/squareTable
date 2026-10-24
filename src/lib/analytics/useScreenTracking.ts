// lib/analytics/useScreenTracking.ts
// 화면 이동·체류를 app_events 에 남긴다(앱·웹 같은 방식). RootLayout 에 한 번 단다.
//   screen_view    {prev_screen, prev_duration_ms} — 경로 템플릿이 바뀔 때
//   app_background {screen, duration_ms}            — 앱이 뒤로 갈 때(바로 보낸다)
//   app_foreground {screen}                         — 다시 앞으로 올 때(체류 타이머 재시작)
// 경로는 expo-router 세그먼트 템플릿이다(예: /owner/knowhow/[id]). 실제 id·토큰은 남지 않는다.
// RN Web 의 AppState 는 document.visibilityState 를 따르므로 웹도 같은 경로로 돈다.
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useSegments } from 'expo-router';
import {
  track,
  setAnalyticsRoute,
  flushAnalyticsOnExit,
  markAnalyticsBackground,
  markAnalyticsForeground,
} from '@/lib/analytics/track';

/** @param enabled 스플래시·세션 로딩이 끝난 뒤에만 true */
export function useScreenTracking(enabled: boolean): void {
  const segments = useSegments();
  const route = '/' + segments.join('/');
  const cur = useRef<{ route: string; since: number } | null>(null);

  useEffect(() => {
    setAnalyticsRoute(route); // 오류 기록(reportError)도 부팅 중부터 템플릿을 쓴다
    if (!enabled || cur.current?.route === route) return;
    const now = Date.now();
    const prev = cur.current;
    track('screen_view', {
      prev_screen: prev?.route ?? null,
      prev_duration_ms: prev ? now - prev.since : null,
    });
    cur.current = { route, since: now };
  }, [enabled, route]);

  useEffect(() => {
    if (!enabled) return;
    // iOS 는 background → inactive → active 로 돌아오기도 한다. 그래서 직전 상태가 아니라 "뒤로 갔었나"로 판정한다.
    let away = false;
    const sub = AppState.addEventListener('change', (next) => {
      const c = cur.current;
      if (next === 'background' && !away) {
        away = true;
        if (c) track('app_background', { screen: c.route, duration_ms: Date.now() - c.since });
        markAnalyticsBackground();
      } else if (next === 'active' && away) {
        away = false;
        markAnalyticsForeground();
        if (c) {
          c.since = Date.now();
          track('app_foreground', { screen: c.route });
        }
      }
    });
    // 웹: 탭을 닫거나 다른 주소로 떠날 때 남은 것을 keepalive 로 보낸다(보통 요청은 페이지와 함께 취소된다).
    const onPageHide = () => flushAnalyticsOnExit();
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
    return () => {
      sub.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled]);
}
