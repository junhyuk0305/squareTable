// useBrandBillingStore.ts — 본사 설정 > 결제 상태(P6). realtime 없음(정본 §6-3).
//
// ★여기 있는 것은 전부 **표시만**이다. 발행·입금 확인·크레딧·환불은 내부 콘솔(service_role)이 한다
//   — 본사 대시보드에는 쓰기 경로가 없다(정본 §4-D "본사 대시보드 설정 > 결제는 표시만").
// ★대상·금액을 화면에서 세지 않는다. 내부 콘솔의 발행과 **같은 함수**(`brand_billing_preview`)를 지난다
//   — 화면이 따로 세면 "화면엔 3곳, 청구서엔 2곳"이 된다.
// `useBrandStore` 에 얹지 않은 이유: 대시보드·매장·노하우·퀴즈 화면은 청구를 안 본다. 결제 화면에서만 부른다.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import {
  fetchBrandBilling,
  fetchBrandInvoices,
  type BrandBillingRow,
  type BrandInvoiceRow,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { reportError } from '@/lib/analytics/track';

/** 'YYYY-MM' 다음 달 — 서버(0222)가 전부 KST 기준이라 여기도 KST 로 센다. */
function nextPeriod(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const t = kst.getUTCFullYear() * 12 + kst.getUTCMonth() + 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

type State = {
  /** 이번 달 청구 대상 */
  current: BrandBillingRow[];
  /** 다음 청구 예정 — 월 중 추가·해제가 여기서 먼저 보인다(정본 §4-D) */
  next: BrandBillingRow[];
  invoices: BrandInvoiceRow[];
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
};

const EMPTY = { current: [], next: [], invoices: [], loaded: false, error: null } satisfies Pick<
  State, 'current' | 'next' | 'invoices' | 'loaded' | 'error'
>;

export const useBrandBillingStore = create<State>((set) => {
  const hydrate = coalesce(async () => {
    const [c, n, i] = await Promise.all([fetchBrandBilling(), fetchBrandBilling(nextPeriod()), fetchBrandInvoices()]);
    const err = c.error ?? n.error ?? i.error;
    if (err) {
      reportError('brandBilling.hydrate', err);
      // 부분 실패도 실패다 — 반만 채운 금액이 '정상'으로 보이는 게 더 위험하다(useBrandStore 와 같은 규칙).
      set({ loaded: true, error: brandErrorMessage(err, '결제 정보를 불러오지 못했어요.') });
      return;
    }
    set({ current: c.data ?? [], next: n.data ?? [], invoices: i.data ?? [], loaded: true, error: null });
  });

  return { ...EMPTY, hydrate, refresh: hydrate, reset: () => set({ ...EMPTY }) };
});
