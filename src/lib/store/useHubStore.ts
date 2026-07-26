// 허브 대시보드(0081) 데이터 스토어 — 사장 현황 탭·직원 오늘 탭이 소비한다.
// 원시 행만 보관하고 판정·정렬은 화면이 파생한다(useCrossNotifStore 와 동일 설계).
// RLS 가 활성 매장만 노출하므로 realtime 불가 — 탭 진입 시점 fetch(포커스 폴링, TTL 로 이중 fetch 방지).
import { create } from 'zustand';
import {
  fetchOwnerOverview,
  fetchOwnerToday,
  fetchMyCrossSummary,
  type OwnerOverviewRow,
  type OwnerTodayRow,
  type MyCrossSummaryRow,
} from '@/lib/db';

const HYDRATE_TTL_MS = 5_000;
let _ownerAt = 0;
let _juniorAt = 0;

type State = {
  overview: OwnerOverviewRow[];
  today: OwnerTodayRow[];
  /** true = overview 최소 1회 성공 — 화면이 "0건"과 "로드 전/실패"를 구분(빈화면 위장 금지). */
  ownerLoaded: boolean;
  /** true = owner_today 최소 1회 성공 — 부분 실패 시 스냅샷이 "0명"으로 위장하지 않도록 분리 추적. */
  todayLoaded: boolean;
  myCross: MyCrossSummaryRow[];
  juniorLoaded: boolean;
  hydrateOwner: () => Promise<void>;
  hydrateJunior: () => Promise<void>;
};

export const useHubStore = create<State>((set) => ({
  overview: [],
  today: [],
  ownerLoaded: false,
  todayLoaded: false,
  myCross: [],
  juniorLoaded: false,

  hydrateOwner: async () => {
    const now = Date.now();
    if (now - _ownerAt < HYDRATE_TTL_MS) return;
    _ownerAt = now;
    const [ov, td] = await Promise.all([fetchOwnerOverview(), fetchOwnerToday()]);
    const okOv = !ov.error && !!ov.data;
    const okTd = !td.error && !!td.data;
    // 하나라도 실패 = TTL 미적용(다음 진입 즉시 재시도). 성공분만 반영하고 실패한 쪽의
    // loaded 플래그는 올리지 않는다 — 부분 실패가 "0건"으로 위장하는 경로 차단(독립 verify 지적).
    if (!okOv || !okTd) _ownerAt = 0;
    if (!okOv && !okTd) return; // 실패 표면화는 db.ts readFail(SyncBanner)
    set((s) => ({
      overview: okOv ? ov.data! : s.overview,
      today: okTd ? td.data! : s.today,
      ownerLoaded: s.ownerLoaded || okOv,
      todayLoaded: s.todayLoaded || okTd,
    }));
  },

  hydrateJunior: async () => {
    const now = Date.now();
    if (now - _juniorAt < HYDRATE_TTL_MS) return;
    _juniorAt = now;
    const { data, error } = await fetchMyCrossSummary();
    if (error || !data) {
      _juniorAt = 0;
      return;
    }
    set({ myCross: data, juniorLoaded: true });
  },
}));
