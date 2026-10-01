// useBrandUnitDetailStore.ts — 매장 상세에서만 쓰는 값: 본사 부담 날짜(0221) + 직영 전용 규칙(0224). realtime 없음.
//
// 둘 다 `brand_overview` 를 넓히지 않고 따로 만든 작은 RPC 다(넓히면 그 위 함수 3개를 drop 해야 한다).
// 목록을 열 때가 아니라 **매장 상세가 열릴 때** 부른다 — 쓰는 곳이 상세뿐이다(useBrandBillingStore 와 같은 모양).
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import {
  fetchBrandPayerDates,
  fetchBrandUnitRules,
  type BrandPayerDateRow,
  type BrandUnitRulesRow,
} from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

type State = {
  /** 매장별 본사 부담 시작·종료일(0221) — 상세의 요금 부담 줄. */
  payerDates: BrandPayerDateRow[];
  /** 매장별 직영 전용 값(0224) — 상세의 하한·해제권·필수 배포. */
  unitRules: BrandUnitRulesRow[];
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
};

const EMPTY = { payerDates: [], unitRules: [], loaded: false, error: null } satisfies Pick<
  State, 'payerDates' | 'unitRules' | 'loaded' | 'error'
>;

export const useBrandUnitDetailStore = create<State>((set) => {
  const hydrate = coalesce(async () => {
    const [d, r] = await Promise.all([fetchBrandPayerDates(), fetchBrandUnitRules()]);
    const err = d.error ?? r.error;
    if (err) {
      reportError('brandUnitDetail.hydrate', err);
      // 부분 실패도 실패다(useBrandStore 와 같은 규칙). 이전 값은 유지한다.
      set({ loaded: true, error: err.message });
      return;
    }
    set({ payerDates: d.data ?? [], unitRules: r.data ?? [], loaded: true, error: null });
  });

  return { ...EMPTY, hydrate, refresh: hydrate, reset: () => set({ ...EMPTY }) };
});
