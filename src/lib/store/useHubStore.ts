// 허브 대시보드(0081) 데이터 스토어 — 사장 현황 탭·직원 오늘 탭이 소비한다.
// 원시 행만 보관하고 판정·정렬은 화면이 파생한다(useCrossNotifStore 와 동일 설계).
// RLS 가 활성 매장만 노출하므로 realtime 불가 — 탭 진입 시점 fetch(포커스 폴링, TTL 로 이중 fetch 방지).
import { create } from 'zustand';
import {
  fetchOwnerOverview,
  fetchOwnerToday,
  fetchMyCrossSummary,
  fetchMyGrowth,
  fetchMyKnowhowEntries,
  type OwnerOverviewRow,
  type OwnerTodayRow,
  type MyCrossSummaryRow,
  type MyGrowthRow,
} from '@/lib/db';
import type { PlaybookEntry } from '@/types';

const HYDRATE_TTL_MS = 5_000;
let _ownerAt = 0;
let _juniorAt = 0;
let _growthAt = 0;
let _myEntriesAt = 0;

type State = {
  overview: OwnerOverviewRow[];
  today: OwnerTodayRow[];
  /** true = overview 최소 1회 성공 — 화면이 "0건"과 "로드 전/실패"를 구분(빈화면 위장 금지). */
  ownerLoaded: boolean;
  /** true = owner_today 최소 1회 성공 — 부분 실패 시 스냅샷이 "0명"으로 위장하지 않도록 분리 추적. */
  todayLoaded: boolean;
  myCross: MyCrossSummaryRow[];
  juniorLoaded: boolean;
  /** 성장 탭(0089) — 본인 매장별 축적. growthLoaded 로 "0건"과 "로드 전/실패"를 구분(빈화면 위장 금지). */
  growth: MyGrowthRow[];
  growthLoaded: boolean;
  /** 내 노하우 원문 목록(0094) — growth 의 my_knowhow 카운트와 동일 술어(어긋나면 RPC 술어 드리프트). */
  myEntries: PlaybookEntry[];
  /** true = 목록 최소 1회 성공 — 성장 탭이 "전부 도착"까지 로딩을 유지(부분 렌더 금지). */
  myEntriesLoaded: boolean;
  hydrateOwner: () => Promise<void>;
  hydrateJunior: () => Promise<void>;
  hydrateGrowth: () => Promise<void>;
  hydrateMyEntries: () => Promise<void>;
};

export const useHubStore = create<State>((set) => ({
  overview: [],
  today: [],
  ownerLoaded: false,
  todayLoaded: false,
  myCross: [],
  juniorLoaded: false,
  growth: [],
  growthLoaded: false,
  myEntries: [],
  myEntriesLoaded: false,

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

  hydrateGrowth: async () => {
    const now = Date.now();
    if (now - _growthAt < HYDRATE_TTL_MS) return;
    _growthAt = now;
    const { data, error } = await fetchMyGrowth();
    if (error || !data) {
      _growthAt = 0; // 실패 = TTL 미적용(다음 진입 즉시 재시도). 표면화는 db.ts readFail.
      return;
    }
    set({ growth: data, growthLoaded: true });
  },

  hydrateMyEntries: async () => {
    const now = Date.now();
    if (now - _myEntriesAt < HYDRATE_TTL_MS) return;
    _myEntriesAt = now;
    const { data, error } = await fetchMyKnowhowEntries();
    if (error || !data) {
      _myEntriesAt = 0;
      return;
    }
    set({ myEntries: data, myEntriesLoaded: true });
  },
}));
