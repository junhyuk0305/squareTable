// useBrandStore.ts — 본사 대시보드 상태(구현계획 §2·정본 §6-3): 브랜드 정체성만 — my_brand 확장 행 + 구성원.
//
// realtime 구독 없음 — 본사 화면은 "지금 이 순간"보다 "한 번에 전 매장"이 중요하고, 수준 하향은 서버가
// 즉시 반영하므로 다음 조회에서 자연히 사라진다(brand-boundary: 캐시는 포커스·새로고침 시 재조회).
// 표 컴포넌트(components/hq)는 여기서 나온 행 배열만 받는다 — 판정·조회를 화면 안에서 하지 않는다.
//
// ★셸(HqShell)이 브랜드 이름 때문에 마운트마다 부른다. 그래서 **여기에 매장 축을 얹지 않는다** —
//   얹으면 어느 화면을 열든 전 매장 요약이 따라 나간다. 매장 축은 `useBrandUnitsStore`,
//   매장 상세의 직영 규칙·부담 날짜는 `useBrandUnitDetailStore`, 청구는 `useBrandBillingStore`.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import {
  fetchMyBrandFull,
  fetchBrandMembers,
  type MyBrandFullRow,
  type BrandMemberRow,
} from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

type State = {
  brand: MyBrandFullRow | null;
  members: BrandMemberRow[];
  /** 첫 조회가 끝났나(실패해도 선다 — 화면은 error 로 갈린다). */
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  /** 쓰기(구성원 초대) 뒤 부른다. hydrate 와 같은 것이지만 이름이 의도를 말한다. */
  refresh: () => Promise<void>;
  reset: () => void;
};

const EMPTY: Pick<State, 'brand' | 'members' | 'loaded' | 'error'> = {
  brand: null, members: [], loaded: false, error: null,
};

export const useBrandStore = create<State>((set) => {
  const hydrate = coalesce(async () => {
    const [b, m] = await Promise.all([fetchMyBrandFull(), fetchBrandMembers()]);
    const err = b.error ?? m.error;
    if (err) {
      reportError('brand.hydrate', err);
      // 부분 실패도 실패다 — 표가 반만 채워진 채 "정상"으로 보이면 그게 더 위험하다. 이전 값은 유지한다.
      set({ loaded: true, error: err.message });
      return;
    }
    set({ brand: b.data, members: m.data ?? [], loaded: true, error: null });
  });
  return {
    ...EMPTY,
    hydrate,
    refresh: hydrate,
    reset: () => set({ ...EMPTY }),
  };
});
