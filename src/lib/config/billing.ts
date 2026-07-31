// 계좌이체 수동과금 안내 정보(실계좌 — 2026-07-10 유료화 전환 시 확정). PG 연동 전까지 사용.
// 가격·티어 한도는 여기 아님 — SSOT = src/lib/config/tiers.ts.

import { BUSINESS_INFO } from '@/lib/config/business';

export const BILLING_INFO = {
  bankName: '국민은행',
  account: '44990101225372',
  holder: '장준혁',
  // 입금 후 알릴 연락처(보조 경로). 주 경로는 0083 submit_payment_claim — 앱에서 입금자명과 함께
  // DB 에 신고하면 관리자 콘솔 /payments 에서 승인한다. 메일은 그 경로가 막혔을 때의 백업이다.
  // ★대외 문의 주소는 business.ts 가 SSOT — 앱·법무고지·스토어 콘솔 지원 이메일이 어긋나면
  //   심사원이 다른 회사로 오인한다. 여기서 별도 주소를 두지 않는다.
  contactLabel: '이메일',
  contactValue: BUSINESS_INFO.email,
} as const;

export function formatKrw(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}
