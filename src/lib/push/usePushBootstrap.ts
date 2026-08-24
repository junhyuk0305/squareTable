// lib/push/usePushBootstrap.ts
// 앱 부팅 시 1회: 웹=서비스워커 등록 + 알림 클릭(SW postMessage) → 라우팅.
//              네이티브=알림 응답 리스너 등록 + 알림 클릭 → 라우팅(nativepush.ts).
// 로그인 세션이 열리고 이미 알림 권한이 있으면 조용히 재구독/토큰갱신을 보장(새 기기 대비).
//
// 두 경로 모두 이 훅 하나에서 부른다 — 각자 "자기 플랫폼이 아니면 no-op"이라(webpush 는 navigator
// 부재 체크, nativepush 는 .web.ts 쌍) 여기서 Platform.OS 분기를 새로 만들 필요가 없다.

import { useEffect } from 'react';
import { router } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canManage } from '@/lib/utils/roles';
import { usePreferencesStore } from '@/lib/store/usePreferencesStore';
import { registerServiceWorker, ensurePushSubscribed } from '@/lib/push/webpush';
import { bindNotificationTapRouting, ensureNativePushRegistered } from '@/lib/push/nativepush';

// 알림 클릭 목적지 경로를 "받는 사람의 역할"에 맞게 교정한다.
// 발송 측(notify.ts)은 수신자가 사장인지 직원인지 모르므로 멘션 등 공용 이벤트를 '/junior/*' 로만 넣는다.
// 사장이 그 알림을 누르면 직원 화면으로 튀므로, 클릭 시점의 세션 역할로 접두사를 뒤집어 준다
// (예: 사장이 언급 알림 클릭 → '/junior/work' → '/owner/work'). 대응 화면이 없으면 원본 유지.
function routeForRole(url: string): string {
  const role = useSessionStore.getState().role;
  // 0093: 매니저는 사장 화면 세트를 쓴다 — '/owner/*' 로 교정.
  if (canManage(role) && url.startsWith('/junior/')) return '/owner/' + url.slice('/junior/'.length);
  if (role === 'junior' && url.startsWith('/owner/')) return '/junior/' + url.slice('/owner/'.length);
  return url;
}

export function usePushBootstrap(): void {
  // 부팅 1회(웹): SW 등록 + 알림 클릭 시 목적지 경로로 네비게이트.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void registerServiceWorker();

    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'push-navigate' && data.url) {
        try {
          router.push(routeForRole(data.url) as never);
        } catch {
          /* 알 수 없는 경로면 무시 — 앱은 열려 있는 상태 유지 */
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // 부팅 1회(네이티브): 알림 탭 → 라우팅 리스너. 웹에서는 nativepush.web.ts 가 no-op.
  useEffect(() => {
    bindNotificationTapRouting();
  }, []);

  // 로그인 세션 + 권한 있음 → 구독/토큰 보장(팝업 없이). userId 확정 후 실행.
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    if (signedIn && userId) {
      void ensurePushSubscribed(userId, unitId || null); // 웹 전용(네이티브 no-op)
      void ensureNativePushRegistered(unitId || null); // 네이티브 전용(웹 no-op)
      void usePreferencesStore.getState().hydrateNotify(); // DB 알림 선호를 로컬 캐시로(전 플랫폼)
    }
  }, [signedIn, userId, unitId]);
}
