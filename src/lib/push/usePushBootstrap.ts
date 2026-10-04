// lib/push/usePushBootstrap.ts
// 앱 부팅 시 1회: 웹=서비스워커 등록 + 알림 클릭(SW postMessage) → 라우팅.
//              네이티브=알림 응답 리스너 등록 + 알림 클릭 → 라우팅(nativepush.ts).
// 로그인 세션이 열리고 이미 알림 권한이 있으면 조용히 재구독/토큰갱신을 보장(새 기기 대비).
//
// 두 경로 모두 이 훅 하나에서 부른다 — 각자 "자기 플랫폼이 아니면 no-op"이라(webpush 는 navigator
// 부재 체크, nativepush 는 .web.ts 쌍) 여기서 Platform.OS 분기를 새로 만들 필요가 없다.

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { WEB_PUSH_ENABLED } from '@/lib/config/store-policy';
import { routeForRole } from '@/lib/utils/roles';
import { usePreferencesStore } from '@/lib/store/usePreferencesStore';
import { registerServiceWorker, ensurePushSubscribed } from '@/lib/push/webpush';
import { bindNotificationTapRouting, ensureNativePushRegistered, releasePendingPushToken } from '@/lib/push/nativepush';

export function usePushBootstrap(): void {
  // 부팅 1회(웹): SW 등록 + 알림 클릭 시 목적지 경로로 네비게이트.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void registerServiceWorker();

    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'push-navigate' && data.url) {
        try {
          // 알림 클릭 목적지를 받는 사람의 역할에 맞춘다. 규칙은 roles.ts routeForRole 하나다(앱 푸시와 같다).
          router.push(routeForRole(data.url, useSessionStore.getState().role) as never);
        } catch {
          /* 알 수 없는 경로면 무시 — 앱은 열려 있는 상태 유지 */
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // 부팅 1회(네이티브): 알림 탭 → 라우팅 리스너. 웹에서는 nativepush.web.ts 가 no-op.
  // 오프라인 로그아웃이 남긴 pending 도 여기서 푼다. 로그인 여부와 상관없다(A1). 등록은 이것이 끝난 뒤에 한다.
  // 앱이 메모리에 남아 있으면 부팅이 다시 오지 않는다. 앱을 다시 열 때(active)마다 다시 푼다(Q3).
  useEffect(() => {
    bindNotificationTapRouting();
    void releasePendingPushToken();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void releasePendingPushToken();
    });
    return () => sub.remove();
  }, []);

  // 로그인 세션 + 권한 있음 → 구독/토큰 보장(팝업 없이). userId 확정 후 실행.
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    if (signedIn && userId) {
      // 웹 푸시는 정책으로 꺼 뒀다(2026-09-22 — 알림은 폰 앱이 받는다). 서비스워커 등록·
      // 알림 클릭 라우팅은 위에 그대로 둔다(PWA 불변식: 헤드 주입·정적 규약 파일은 안 건드린다).
      if (WEB_PUSH_ENABLED) void ensurePushSubscribed(userId, unitId || null); // 웹 전용(네이티브 no-op)
      void ensureNativePushRegistered(unitId || null); // 네이티브 전용(웹 no-op)
      void usePreferencesStore.getState().hydrateNotify(); // DB 알림 선호를 로컬 캐시로(전 플랫폼)
    }
  }, [signedIn, userId, unitId]);
}
