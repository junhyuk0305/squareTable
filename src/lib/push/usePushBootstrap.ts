// lib/push/usePushBootstrap.ts
// 앱 부팅 시 1회: 서비스워커 등록 + 알림 클릭(SW postMessage) → 앱 내 라우팅.
// 로그인 세션이 열리고 이미 알림 권한이 있으면 조용히 재구독을 보장(새 기기/구독 회전 대비).
//
// 웹 전용. 네이티브에서는 pushSupported()=false 라 전부 no-op.

import { useEffect } from 'react';
import { router } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { registerServiceWorker, ensurePushSubscribed } from '@/lib/push/webpush';

export function usePushBootstrap(): void {
  // 부팅 1회: SW 등록 + 알림 클릭 시 목적지 경로로 네비게이트.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void registerServiceWorker();

    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'push-navigate' && data.url) {
        try {
          router.push(data.url as never);
        } catch {
          /* 알 수 없는 경로면 무시 — 앱은 열려 있는 상태 유지 */
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // 로그인 세션 + 권한 있음 → 구독 보장(팝업 없이). userId 확정 후 실행.
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    if (signedIn && userId) void ensurePushSubscribed(userId, unitId || null);
  }, [signedIn, userId, unitId]);
}
