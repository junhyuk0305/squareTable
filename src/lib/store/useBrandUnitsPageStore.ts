// useBrandUnitsPageStore.ts — 매장 화면 왼쪽 목록: 한 쪽(brand_overview_page · 0228) + 초대(brand_invites_list). realtime 없음.
//
// ★검색·필터·정렬·쪽은 **서버에서** 한다. 한 쪽만 받아 클라가 정렬하면 전체 순위가 아니라 그 쪽 안 순위가 된다.
//   그래서 표 머리글 클릭 = 이 스토어의 `setQuery` = 재조회다(HqTable 은 제어 모드로 받기만 한다).
// `useBrandUnitsStore`(전 매장 한 번에)와 따로 둔 이유: 대시보드 KPI·노하우/퀴즈 교차표·설정 청구 줄은
//   지금도 **전 매장 집계**가 재료다. 목록만 쪽으로 나눈다(R5 지시 — 대시보드 표는 상위 N행 + 전체 보기).
import { create } from 'zustand';
import {
  fetchBrandOverviewPage,
  fetchBrandInvites,
  type BrandOverviewQuery,
  type BrandOverviewRow,
  type BrandInviteRow,
} from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

/**
 * 한 쪽 = 50곳. 파일럿·초기 고객(수십 곳)은 한 쪽에 다 들어와 쪽 넘김을 볼 일이 없고,
 * 수백 곳이면 쪽을 넘긴다. 표 한 줄 52px × 50 ≈ 2,600px — 스크롤 몇 번이면 끝까지 본다.
 * 더 키우면 한 번에 받는 집계 행이 늘고, 줄이면 수십 곳 브랜드도 쪽을 넘겨야 한다.
 */
export const HQ_STORES_PAGE_SIZE = 50;

const DEFAULT_QUERY: BrandOverviewQuery = {
  limit: HQ_STORES_PAGE_SIZE, offset: 0, sort: 'name', desc: false, q: null, relation: null, visibility: null,
};
const filtered = (q: BrandOverviewQuery) => !!(q.q?.trim() || q.relation || q.visibility);

type State = {
  query: BrandOverviewQuery;
  rows: BrandOverviewRow[];
  /** 거른 뒤 전체 개수(쪽 나누기 분모). */
  total: number;
  /** 거르기 전 연결 매장 수("연결된 매장 N곳" — 검색 중에도 브랜드 전체 수). */
  totalAll: number;
  invites: BrandInviteRow[];
  /** 첫 조회(쪽 + 초대)가 끝났나 — 실패해도 선다(ui.md 게이트 계약). */
  loaded: boolean;
  error: string | null;
  /** 검색·필터·정렬을 바꾸면 1쪽으로 돌아간다. 쪽만 바꿀 때는 `offset` 을 같이 넘긴다. */
  setQuery: (patch: Partial<Omit<BrandOverviewQuery, 'limit'>>) => void;
  /** 포커스·쓰기 뒤 — 지금 조건 그대로 쪽 + 초대를 다시 받는다. */
  refresh: () => Promise<void>;
  /**
   * 화면을 **떠날 때** 부른다 — 조건·결과를 처음으로(예전처럼 화면을 떠나면 필터가 풀린다).
   * 열 때 비우면 첫 프레임에 지난번 쪽이 스쳤다가 바뀐다. 떠날 때 비우면 다음에 열 때 게이트부터 선다.
   */
  reset: () => void;
};

const EMPTY = { query: DEFAULT_QUERY, rows: [], total: 0, totalAll: 0, invites: [], loaded: false, error: null } satisfies Pick<
  State, 'query' | 'rows' | 'total' | 'totalAll' | 'invites' | 'loaded' | 'error'
>;

// 요청 번호 — 정렬을 연달아 바꾸면 응답이 순서대로 오지 않는다. 마지막 요청의 응답만 받는다.
let seq = 0;
// 화면 세대 — reset 마다 오른다. 떠나기 전에 보낸 초대 조회가 늦게 와도 버린다.
let gen = 0;

export const useBrandUnitsPageStore = create<State>((set, get) => {
  const loadPage = async () => {
    const my = ++seq;
    const query = get().query;
    const r = await fetchBrandOverviewPage(query);
    if (my !== seq) return;
    if (r.error) {
      reportError('brandUnitsPage.load', r.error);
      // 이전 쪽을 그대로 둔다 — 표가 비면 "매장 없음"으로 읽힌다.
      set({ error: r.error.message });
      return;
    }
    const rows = r.data ?? [];
    // 빈 쪽은 개수를 못 준다(창 함수는 행에 실린다). 끝을 넘긴 쪽이면 1쪽으로 되돌린다
    // (마지막 쪽의 마지막 매장이 해제된 경우 등).
    if (rows.length === 0 && query.offset > 0) {
      get().setQuery({ offset: 0 });
      return;
    }
    set({
      rows,
      total: rows[0]?.total_count ?? 0,
      // 거른 결과가 0건이면 거르기 전 수도 안 온다 — 알던 값을 둔다(거르지 않은 0건이면 진짜 0곳).
      totalAll: rows[0]?.total_all ?? (filtered(query) ? get().totalAll : 0),
      error: null,
    });
  };

  return {
    ...EMPTY,
    setQuery: (patch) => {
      set({ query: { ...get().query, offset: 0, ...patch } });
      void loadPage();
    },
    refresh: async () => {
      const g = gen;
      const [, i] = await Promise.all([loadPage(), fetchBrandInvites()]);
      if (g !== gen) return;
      if (i.error) {
        reportError('brandUnitsPage.invites', i.error);
        // 부분 실패도 실패다 — 초대 표가 비어 "기다리는 초대가 없어요"로 보이면 그게 더 위험하다.
        set({ loaded: true, error: i.error.message });
        return;
      }
      set({ invites: i.data ?? [], loaded: true });
    },
    reset: () => {
      // 떠난 뒤 도착하는 응답(쪽·초대)이 빈 스토어를 다시 채우지 않게
      seq++;
      gen++;
      set({ ...EMPTY });
    },
  };
});
