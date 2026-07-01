// 계좌이체 수동과금 안내 정보. PG 연동 전까지 사용.
// ⚠️ TODO(장준혁): 아래 실제 값으로 교체 — 은행/계좌번호/예금주/금액/문의 연락처.
//    가격은 아직 미확정(좌석밴드 티어 검토 중) → 우선 단일 월정액 placeholder.

export const BILLING_INFO = {
  bankName: '○○은행', // TODO: 실제 은행
  account: '000-0000-0000-00', // TODO: 실제 계좌번호
  holder: '스퀘어테이블', // TODO: 예금주
  monthlyPriceKrw: 29000, // TODO: 확정 가격
  // 입금 후 알릴 연락처(카톡/전화/이메일). 사용자가 여기로 입금 사실을 알리면 운영자가 확인 후 활성화.
  contactLabel: '카카오톡 채널',
  contactValue: '@스퀘어테이블', // TODO: 실제 채널/번호/이메일
} as const;

export function formatKrw(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}
