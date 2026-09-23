// useBrandStore.ts — 본사 대시보드 상태(구현계획 §2·정본 §6-3): RPC 1회 → 캐시 → 포커스·수동 새로고침.
//
// realtime 구독 없음 — 본사 화면은 "지금 이 순간"보다 "한 번에 전 매장"이 중요하고, 수준 하향은 서버가
// 즉시 반영하므로 다음 조회에서 자연히 사라진다(brand-boundary: 캐시는 포커스·새로고침 시 재조회).
// 표 컴포넌트(components/hq)는 여기서 나온 행 배열만 받는다 — 판정·조회를 화면 안에서 하지 않는다.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import {
  fetchMyBrandFull,
  fetchBrandOverview,
  fetchBrandInvites,
  fetchBrandMembers,
  fetchBrandPayerDates,
  fetchBrandUnitRules,
  type MyBrandFullRow,
  type BrandOverviewRow,
  type BrandInviteRow,
  type BrandMemberRow,
  type BrandPayerDateRow,
  type BrandUnitRulesRow,
} from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

type State = {
  brand: MyBrandFullRow | null;
  overview: BrandOverviewRow[];
  invites: BrandInviteRow[];
  members: BrandMemberRow[];
  /** 매장별 본사 부담 시작·종료일(0221) — 매장 드로어 payer 줄. `brand_overview` 를 넓히지 않았다(그 위 함수 3개를 drop 해야 한다). */
  payerDates: BrandPayerDateRow[];
  /** 매장별 직영 전용 값(0224) — 매장 드로어의 하한·해제권·필수 배포. `brand_overview` 를 넓히지 않았다. */
  unitRules: BrandUnitRulesRow[];
  /** 첫 조회가 끝났나(실패해도 선다 — 화면은 error 로 갈린다). */
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  /** 쓰기(초대·요청·해제) 뒤 부른다. hydrate 와 같은 것이지만 이름이 의도를 말한다. */
  refresh: () => Promise<void>;
  reset: () => void;
};

const EMPTY: Pick<State, 'brand' | 'overview' | 'invites' | 'members' | 'payerDates' | 'unitRules' | 'loaded' | 'error'> = {
  brand: null, overview: [], invites: [], members: [], payerDates: [], unitRules: [], loaded: false, error: null,
};

export const useBrandStore = create<State>((set) => {
  const hydrate = coalesce(async () => {
    const [b, o, i, m, d, r] = await Promise.all([
      fetchMyBrandFull(), fetchBrandOverview(), fetchBrandInvites(), fetchBrandMembers(), fetchBrandPayerDates(),
      fetchBrandUnitRules(),
    ]);
    const err = b.error ?? o.error ?? i.error ?? m.error ?? d.error ?? r.error;
    if (err) {
      reportError('brand.hydrate', err);
      // 부분 실패도 실패다 — 표가 반만 채워진 채 "정상"으로 보이면 그게 더 위험하다. 이전 값은 유지한다.
      set({ loaded: true, error: err.message });
      return;
    }
    set({
      brand: b.data,
      // 정본 §4-A: 정렬 기본 = 이름순. 문제 순은 헤더 클릭으로만(표 컴포넌트).
      overview: [...(o.data ?? [])].sort((x, y) => x.store_name.localeCompare(y.store_name, 'ko')),
      invites: i.data ?? [],
      members: m.data ?? [],
      payerDates: d.data ?? [],
      unitRules: r.data ?? [],
      loaded: true,
      error: null,
    });
  });
  return {
    ...EMPTY,
    hydrate,
    refresh: hydrate,
    reset: () => set({ ...EMPTY }),
  };
});
