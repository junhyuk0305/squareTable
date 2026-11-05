import { useEffect } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { MEMBERSHIP_POLL_MS } from '@/lib/store/sessionLoadPolicy';
import { subscribeMyMembership, subscribeMyProfile } from '@/lib/db';

/**
 * 소속 상태 동기화 — owner·junior 레이아웃이 같은 effect 를 두 벌 들고 있던 것을 한 훅으로 모았다(M3 · 2026-11-05).
 *
 * realtime 이 즉시 잡는 것(여기 구독): 매니저 지정·해제(unit_members UPDATE · 0315) · 내보내기·합류 승인(profiles UPDATE).
 * 폴링이 맡는 것: publication 밖 사건 — unit_subscriptions(계좌이체 활성 → /billing 해제) · units 닫힘(0284) · 좌석 잠금(0115·0315) ·
 *   brand_members. 이것들은 realtime 으로 못 받으므로 폴링을 없앨 수 없다.
 * 간격 20/30초 → 120초(사용자 결정 2026-11-05). 서버는 즉시 막으므로 보안 영향은 없고 화면 안내만 최대 2분 늦다.
 * 채널이 끊겼다 다시 붙으면(CHANNEL_ERROR/TIMED_OUT → SUBSCRIBED) 끊긴 사이 놓친 사건을 메우려 1회 다시 읽는다(onResubscribe).
 *
 * 사장은 profiles 를 구독하지 않는다 — 사장 본인 행은 타인이 바꾸지 않는다(승인·내보내기는 직원 행에 일어난다).
 *   사장 폴링의 목적은 계좌이체 수동 과금 반영(unit_subscriptions.status=active)이고 그건 publication 밖이라 구독으로 못 받는다.
 *
 * 모든 호출은 soft 다 — 진행 중인 로드가 있으면 합치고 직전 성공 5초 안이면 생략한다(쓰기 뒤가 아니라 "사건이 있었다"는 신호라 충분).
 */
export function useMembershipSync(opts: { enabled: boolean; userId: string | null; role: 'owner' | 'junior' }) {
  const { enabled, userId, role } = opts;
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void useSessionStore.getState().refreshMembership({ soft: true, source: 'poll' });
    const offRole = userId ? subscribeMyMembership(userId, refresh, refresh) : () => {};
    const offProfile = role === 'junior' && userId ? subscribeMyProfile(userId, refresh, refresh) : () => {};
    const id = setInterval(refresh, MEMBERSHIP_POLL_MS);
    return () => {
      offRole();
      offProfile();
      clearInterval(id);
    };
  }, [enabled, userId, role]);
}
