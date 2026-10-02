// billing.ts — 정산 규칙 안내 문구의 정본(기획정본 §4-D "정산·환불 규칙" 표 · 계약 제5조 제2항).
//
// 본사 설정 > 결제와 점주 설정 > 본사 연결이 **같은 규칙**을 다른 말로 적으면, 청구서를 받은 본사와
// 알림을 받은 점주가 서로 다른 날짜를 기대한다. `visibility.ts` 와 같은 이유로 여기 한 곳만 고친다.
// ⛔점주 화면에는 금액이 없다 — 점주는 누가 내는지(payer)와 언제까지인지만 본다(정본 §4-D 금지선).
import type { BrandInvoiceRow } from '@/lib/brand/brandDb';

/** 본사 설정 > 결제 아래 안내 — 정본 §4-D 표 4행을 그대로 한 줄씩. */
export const BILLING_RULES = [
  '월 중에 매장이 늘면 바로 쓸 수 있고, 요금은 다음 청구부터예요.',
  '해제하거나 매장 부담으로 바꾸면 그 달 말까지는 본사 부담이고, 다음 청구에서 빠져요.',
  '매장 부담이던 곳은 그 매장이 낸 기간이 끝난 다음 날부터 본사 청구로 넘어와요.',
  '아직 시작하지 않은 달은 환불하거나 다음 청구에서 빼 드려요.',
];

/** 청구서 상태 — 내부 콘솔(0222 brand_invoices.status)과 같은 값. */
export const INVOICE_STATUS: Record<BrandInvoiceRow['status'], string> = {
  issued: '발행',
  paid: '입금 확인',
  credited: '크레딧',
  refunded: '환불',
};

export const krw = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `${n.toLocaleString()}원`;

/** '2026-09' → '2026년 9월' — 기간은 월 단위라 날짜를 붙이지 않는다. */
export const periodLabel = (p: string): string => {
  const [y, m] = p.split('-');
  return y && m ? `${y}년 ${Number(m)}월` : p;
};
