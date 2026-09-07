// 계좌이체 수동과금 안내 정보(실계좌). PG 연동 전까지 사용.
// 가격·티어 한도는 여기 아님 — SSOT = src/lib/config/tiers.ts.
//
// ★2026-09-07 전면 교체: 개인 계좌(국민 449901…·예금주 장준혁) → **사업자 통장**(토스뱅크·예금주 스퀘어테이블).
//   예금주가 개인 이름이면 사장은 "이 회사가 맞나"를 결제 직전에 의심한다 —
//   상호(BUSINESS_INFO.name)와 예금주가 같아야 그 의심이 없다.
// ★account 는 **숫자만** 넣는다. 화면의 복사 버튼이 이 값을 그대로 복사하고,
//   은행 앱에 붙여넣을 때 하이픈·공백이 섞이면 실패한다.

import { BUSINESS_INFO } from '@/lib/config/business';

export const BILLING_INFO = {
  bankName: '토스뱅크',
  account: '100273135646',
  holder: '스퀘어테이블',
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
