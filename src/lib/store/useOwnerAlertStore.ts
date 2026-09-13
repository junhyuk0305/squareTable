// 사장 알림(owner_alerts, 0191) — 좌석 잠김 · AI 사용량 80%·100%.
// 벨 배지·알림 목록의 한 축(판정 SSOT = utils/notifications.ts). 사장 전용 축이라 매니저·직원은 빈 배열이 정상이다.
// realtime 미구독: 입금 신고(usePaymentClaimStore)와 같은 이유 — 푸시가 먼저 알리고, 알림함은 진입 시 재조회로 충분.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import type { OwnerAlert } from '@/types';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchOwnerAlerts } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';

type State = {
  alerts: OwnerAlert[];
  loaded: boolean;
  hydrate: () => Promise<void>;
};

export const useOwnerAlertStore = create<State>((set) => ({
  alerts: [],
  loaded: !HAS_SUPABASE,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const unitId = useSessionStore.getState().unitId;
    if (!unitId) {
      set({ alerts: [], loaded: true });
      return;
    }
    const { data } = await fetchOwnerAlerts(unitId);
    // 실패는 db 계층이 표면화한다 — loaded 는 "기다리기가 끝났나"라 실패해도 세운다.
    set({ alerts: data, loaded: true });
  }),
}));
