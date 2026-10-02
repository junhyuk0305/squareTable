// useBrandUnitsStore.ts — 본사의 매장 축: 연결 매장 요약(brand_overview) + 초대(brand_invites_list). realtime 없음(정본 §6-3).
//
// 쓰는 화면 = 대시보드(KPI 는 전 매장 집계) · 노하우/퀴즈(교차표 열과 배포 대상이 연결 매장이다) · 설정(청구 줄의 관계·부담 수).
// 매장 화면은 쓰지 않는다 — 목록은 쪽(useBrandUnitsPageStore), 상세는 한 매장(useBrandUnitDetailStore)으로 받는다(0228).
// `useBrandStore` 에 얹지 않은 이유: 셸이 브랜드 이름 때문에 그걸 늘 부른다 — 거기 얹으면 매장 축이 모든 화면에 따라붙는다.
// 화면이 자기 포커스에서 부른다(useBrandBillingStore 와 같은 모양).
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import {
  fetchBrandOverview,
  fetchBrandInvites,
  type BrandOverviewRow,
  type BrandInviteRow,
} from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

type State = {
  overview: BrandOverviewRow[];
  invites: BrandInviteRow[];
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  /** 쓰기(초대·요청·해제) 뒤 부른다. hydrate 와 같은 것이지만 이름이 의도를 말한다. */
  refresh: () => Promise<void>;
  reset: () => void;
};

const EMPTY = { overview: [], invites: [], loaded: false, error: null } satisfies Pick<
  State, 'overview' | 'invites' | 'loaded' | 'error'
>;

export const useBrandUnitsStore = create<State>((set) => {
  const hydrate = coalesce(async () => {
    const [o, i] = await Promise.all([fetchBrandOverview(), fetchBrandInvites()]);
    const err = o.error ?? i.error;
    if (err) {
      reportError('brandUnits.hydrate', err);
      // 부분 실패도 실패다 — 표가 반만 채워진 채 "정상"으로 보이면 그게 더 위험하다. 이전 값은 유지한다.
      set({ loaded: true, error: err.message });
      return;
    }
    set({
      // 정본 §4-A: 정렬 기본 = 이름순. 문제 순은 헤더 클릭으로만(표 컴포넌트).
      overview: [...(o.data ?? [])].sort((x, y) => x.store_name.localeCompare(y.store_name, 'ko')),
      invites: i.data ?? [],
      loaded: true,
      error: null,
    });
  });

  return { ...EMPTY, hydrate, refresh: hydrate, reset: () => set({ ...EMPTY }) };
});
