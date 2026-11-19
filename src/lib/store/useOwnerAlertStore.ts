// 사장 알림(owner_alerts, 0191) — 좌석 잠김 · AI 사용량 80%·100%.
// 벨 배지·알림 목록의 한 축(판정 SSOT = utils/notifications.ts). 사장 전용 축이라 매니저·직원은 빈 배열이 정상이다.
// 실시간(★0900 · 2026-11-19 "바로 와야 해"): 새 회차가 앱을 켠 채로 벨에 뜬다. 구독은 owner/_layout 한 곳에서 건다.
import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { currentTenantEpoch, isStaleEpoch } from '@/lib/store/tenantEpoch';
import type { OwnerAlert } from '@/types';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchOwnerAlerts, subscribeOwnerAlerts } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';

type State = {
  alerts: OwnerAlert[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
};

export const useOwnerAlertStore = create<State>((set, get) => ({
  alerts: [],
  loaded: !HAS_SUPABASE,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const unitId = useSessionStore.getState().unitId;
    if (!unitId) {
      set({ alerts: [], loaded: true });
      return;
    }
    const epoch = currentTenantEpoch();
    const { data } = await fetchOwnerAlerts(unitId);
    if (isStaleEpoch(epoch)) return; // 그 사이 매장이 바뀌었다 — 이전 매장 알림을 쓰지 않는다
    // 실패는 db 계층이 표면화한다 — loaded 는 "기다리기가 끝났나"라 실패해도 세운다.
    set({ alerts: data, loaded: true });
  }),

  subscribe: () => subscribeDebounced(subscribeOwnerAlerts, () => void get().hydrate(), 300, 'owner-alerts'),
}));
