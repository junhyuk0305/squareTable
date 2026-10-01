// useBrandUnitDetailStore.ts — 매장 상세 한 칸의 재료: 그 매장 행(0228 · p_units=[id]) + 본사 부담 날짜(0221) + 직영 전용 규칙(0224).
// realtime 없음.
//
// 부담 날짜·직영 규칙은 `brand_overview` 를 넓히지 않고 따로 만든 작은 RPC 다(넓히면 그 위 함수 3개를 drop 해야 한다).
// 목록을 열 때가 아니라 **상세가 열릴 때** 부른다 — 쓰는 곳이 상세뿐이다(useBrandBillingStore 와 같은 모양).
// 매장 행도 여기서 받는다 — 상세 하나를 그리려고 전 매장 요약(brand_overview)을 받지 않는다.
import { create } from 'zustand';
import {
  fetchBrandOverviewPage,
  fetchBrandPayerDates,
  fetchBrandUnitRules,
  type BrandOverviewRow,
  type BrandPayerDateRow,
  type BrandUnitRulesRow,
} from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';

type State = {
  /** 지금 재료가 어느 매장 것인가 — 화면은 자기 id 와 같을 때만 그린다(갈아 끼울 때 옛 매장 값이 스치지 않게). */
  unitId: string | null;
  /** 그 매장의 overview 행. null = 내 브랜드의 active 연결 매장이 아니다. */
  row: BrandOverviewRow | null;
  /** 매장별 본사 부담 시작·종료일(0221) — 상세의 요금 부담 줄. */
  payerDates: BrandPayerDateRow[];
  /** 매장별 직영 전용 값(0224) — 상세의 하한·해제권·필수 배포. */
  unitRules: BrandUnitRulesRow[];
  loaded: boolean;
  error: string | null;
  load: (unitId: string) => Promise<void>;
  /** 쓰기 뒤 — 지금 매장 그대로 다시 받는다. */
  refresh: () => Promise<void>;
};

// 요청 번호 — 2단에서 매장을 빠르게 갈아 끼우면 응답 순서가 뒤바뀐다. 마지막 요청만 받는다.
let seq = 0;

export const useBrandUnitDetailStore = create<State>((set, get) => {
  const load = async (unitId: string) => {
    const my = ++seq;
    // 다른 매장으로 바뀌면 게이트를 다시 세운다. 같은 매장 재조회(쓰기 뒤)는 지금 화면을 둔다.
    // ★행도 비운다 — 새 매장 조회가 실패하면 옛 매장 행이 새 주소 아래 그려진다.
    if (get().unitId !== unitId) set({ unitId, row: null, loaded: false, error: null });
    const [p, d, r] = await Promise.all([
      fetchBrandOverviewPage({ limit: 1, offset: 0, sort: 'name', desc: false, units: [unitId] }),
      fetchBrandPayerDates(),
      fetchBrandUnitRules(),
    ]);
    if (my !== seq) return;
    const err = p.error ?? d.error ?? r.error;
    if (err) {
      reportError('brandUnitDetail.load', err);
      // 부분 실패도 실패다(useBrandStore 와 같은 규칙). 이전 값은 유지한다.
      set({ loaded: true, error: err.message });
      return;
    }
    set({ row: p.data?.[0] ?? null, payerDates: d.data ?? [], unitRules: r.data ?? [], loaded: true, error: null });
  };

  return {
    unitId: null,
    row: null,
    payerDates: [],
    unitRules: [],
    loaded: false,
    error: null,
    load,
    refresh: async () => {
      const id = get().unitId;
      if (id) await load(id);
    },
  };
});
