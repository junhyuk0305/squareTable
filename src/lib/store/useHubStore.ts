// 허브 대시보드(0081) 데이터 스토어 — 사장 현황 탭·직원 오늘 탭이 소비한다.
// 원시 행만 보관하고 판정·정렬은 화면이 파생한다(useCrossNotifStore 와 동일 설계).
// RLS 가 활성 매장만 노출하므로 realtime 불가 — 탭 진입 시점 fetch(포커스 폴링, TTL 로 이중 fetch 방지).
import { create } from 'zustand';
import {
  fetchOwnerOverview,
  fetchOwnerToday,
  fetchOwnerKnowhowStats,
  fetchMyCrossSummary,
  fetchMyGrowth,
  fetchMyKnowhowEntries,
  type OwnerOverviewRow,
  type OwnerTodayRow,
  type OwnerKnowhowStatRow,
  type MyCrossSummaryRow,
  type MyGrowthRow,
} from '@/lib/db';
import type { PlaybookEntry } from '@/types';

const HYDRATE_TTL_MS = 5_000;
let _ownerAt = 0;
let _juniorAt = 0;
let _growthAt = 0;
let _myEntriesAt = 0;
let _knowhowStatsAt = 0;

// ★2026-08-25 계약 통일: `loaded` = **"시도가 끝났다"**(성공/실패 무관). 실패는 `*LoadError` 로 분리한다.
//   예전 계약("실패하면 loaded 를 안 올림")은 장애를 '로딩 중'으로 위장했다 — 사장이 로그인 직후
//   착지하는 현황 화면이 읽기 4개를 AND 게이트로 묶는 탓에 **하나만 실패해도 영원히 스피너**였고,
//   마운트 1회 fetch 라 재시도 경로조차 없었다(#6). 세 번째 상태가 없으면 게이트는 반드시 거짓말한다.
//   화면 3분기 규약: !loaded → 스피너 / loadError → "불러오지 못했어요 · 다시 시도" / 0건 → 빈 상태+CTA.
type State = {
  overview: OwnerOverviewRow[];
  today: OwnerTodayRow[];
  /** true = overview 조회 시도가 끝남(성공·실패 무관). 실패 여부는 ownerLoadError 로 본다. */
  ownerLoaded: boolean;
  /** true = owner_today 조회 시도가 끝남. 부분 실패를 분리 추적한다. */
  todayLoaded: boolean;
  /** 마지막 overview 조회가 실패했는가 — 화면이 "0건"과 "못 불러옴"을 구분해 재시도 UI를 띄운다. */
  ownerLoadError: boolean;
  /** 마지막 owner_today 조회가 실패했는가. */
  todayLoadError: boolean;
  myCross: MyCrossSummaryRow[];
  juniorLoaded: boolean;
  juniorLoadError: boolean;
  /** 성장 탭(0089) — 본인 매장별 축적. */
  growth: MyGrowthRow[];
  growthLoaded: boolean;
  growthLoadError: boolean;
  /** 내 노하우 원문 목록(0094) — growth 의 my_knowhow 카운트와 동일 술어(어긋나면 RPC 술어 드리프트). */
  myEntries: PlaybookEntry[];
  myEntriesLoaded: boolean;
  myEntriesLoadError: boolean;
  /** 노하우 이해도 지표(0120) — 노하우 탭 전용이라 hydrateOwner 와 분리한다(현황 탭이 값을 치르지 않게). */
  knowhowStats: OwnerKnowhowStatRow[];
  knowhowStatsLoaded: boolean;
  knowhowStatsLoadError: boolean;
  hydrateOwner: () => Promise<void>;
  hydrateJunior: () => Promise<void>;
  hydrateGrowth: () => Promise<void>;
  hydrateMyEntries: () => Promise<void>;
  hydrateKnowhowStats: () => Promise<void>;
  /** 재시도 — TTL 을 무시하고 즉시 다시 당긴다. 실패 화면의 '다시 시도' 버튼이 부르는 유일한 경로. */
  retryOwner: () => Promise<void>;
};

export const useHubStore = create<State>((set, get) => ({
  overview: [],
  today: [],
  ownerLoaded: false,
  todayLoaded: false,
  ownerLoadError: false,
  todayLoadError: false,
  myCross: [],
  juniorLoaded: false,
  juniorLoadError: false,
  growth: [],
  growthLoaded: false,
  growthLoadError: false,
  myEntries: [],
  myEntriesLoaded: false,
  myEntriesLoadError: false,
  knowhowStats: [],
  knowhowStatsLoaded: false,
  knowhowStatsLoadError: false,

  hydrateKnowhowStats: async () => {
    const now = Date.now();
    if (now - _knowhowStatsAt < HYDRATE_TTL_MS) return;
    _knowhowStatsAt = now;
    const { data, error } = await fetchOwnerKnowhowStats();
    if (error || !data) {
      _knowhowStatsAt = 0; // 실패 = TTL 미적용(다음 진입 즉시 재시도). 표면화는 db.ts readFail.
      // 시도는 끝났다 → loaded 는 올리고 실패는 LoadError 로 말한다(영구 스피너 금지).
      set({ knowhowStatsLoaded: true, knowhowStatsLoadError: true });
      return;
    }
    set({ knowhowStats: data, knowhowStatsLoaded: true, knowhowStatsLoadError: false });
  },

  hydrateOwner: async () => {
    const now = Date.now();
    if (now - _ownerAt < HYDRATE_TTL_MS) return;
    _ownerAt = now;
    const [ov, td] = await Promise.all([fetchOwnerOverview(), fetchOwnerToday()]);
    const okOv = !ov.error && !!ov.data;
    const okTd = !td.error && !!td.data;
    // 하나라도 실패 = TTL 미적용(다음 진입 즉시 재시도).
    if (!okOv || !okTd) _ownerAt = 0;
    // ★성공분만 반영하되 loaded 는 **양쪽 다** 올린다 — 실패는 LoadError 로 전달한다.
    //   예전엔 여기서 early return 하고 loaded 를 안 올려, 이 플래그를 AND 로 묶은 현황 화면이
    //   영구 스피너가 됐다(#6). 데이터는 직전 성공분을 유지해 화면이 갑자기 비지 않게 한다.
    set((s) => ({
      overview: okOv ? ov.data! : s.overview,
      today: okTd ? td.data! : s.today,
      ownerLoaded: true,
      todayLoaded: true,
      ownerLoadError: !okOv,
      todayLoadError: !okTd,
    }));
  },

  // 실패 화면의 '다시 시도' 전용 — TTL 을 비워 즉시 재조회한다(마운트 1회 fetch 라 이 경로가 없으면
  // 화면을 나갔다 와도 TTL 때문에 그대로다).
  retryOwner: async () => {
    _ownerAt = 0;
    await get().hydrateOwner();
  },

  hydrateJunior: async () => {
    const now = Date.now();
    if (now - _juniorAt < HYDRATE_TTL_MS) return;
    _juniorAt = now;
    const { data, error } = await fetchMyCrossSummary();
    if (error || !data) {
      _juniorAt = 0;
      set({ juniorLoaded: true, juniorLoadError: true });
      return;
    }
    set({ myCross: data, juniorLoaded: true, juniorLoadError: false });
  },

  hydrateGrowth: async () => {
    const now = Date.now();
    if (now - _growthAt < HYDRATE_TTL_MS) return;
    _growthAt = now;
    const { data, error } = await fetchMyGrowth();
    if (error || !data) {
      _growthAt = 0; // 실패 = TTL 미적용(다음 진입 즉시 재시도). 표면화는 db.ts readFail.
      set({ growthLoaded: true, growthLoadError: true });
      return;
    }
    set({ growth: data, growthLoaded: true, growthLoadError: false });
  },

  hydrateMyEntries: async () => {
    const now = Date.now();
    if (now - _myEntriesAt < HYDRATE_TTL_MS) return;
    _myEntriesAt = now;
    const { data, error } = await fetchMyKnowhowEntries();
    if (error || !data) {
      _myEntriesAt = 0;
      set({ myEntriesLoaded: true, myEntriesLoadError: true });
      return;
    }
    set({ myEntries: data, myEntriesLoaded: true, myEntriesLoadError: false });
  },
}));
