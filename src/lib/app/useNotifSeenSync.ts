import { useEffect } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { subscribeMyNotifSeen } from '@/lib/db';

/**
 * 알림 읽음 실시간(2026-11-16 사용자 결정 · R-13 · 0810) — 같은 계정의 다른 기기에서 전체 읽음을 누르면 이 기기도 바로 꺼진다.
 * 루트 _layout 에서 1회. 매장·허브·공간 어느 층에 있어도 돈다(읽은 시각은 계정의 것이다).
 * 채널이 끊겼다 다시 붙으면 놓친 값을 메우려 한 번 다시 읽는다(retry = TTL 무시).
 */
export function useNotifSeenSync(): void {
  const userId = useSessionStore((s) => s.userId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    if (!signedIn || !userId) return;
    const { applySeen, applyRowRead, retry, hydrate } = useMemberPrefsStore.getState();
    // 앱 배지·공간 벨은 알림 화면을 안 열어도 읽은 시각이 필요하다(없으면 전부 안 읽음으로 센다).
    void hydrate();
    return subscribeMyNotifSeen(userId, applySeen, () => void retry(), applyRowRead);
  }, [signedIn, userId]);
}
