// 계좌이체 수동과금 안내 정보(실계좌 — 2026-07-10 유료화 전환 시 확정). PG 연동 전까지 사용.
// 가격·티어 한도는 여기 아님 — SSOT = src/lib/config/tiers.ts (파일럿 할인가 적용 중).

export const BILLING_INFO = {
  bankName: '국민은행',
  account: '44990101225372',
  holder: '장준혁',
  // 입금 후 알릴 연락처. 사용자가 여기로 입금 사실을 알리면 운영자가 확인 후 활성화(admin_activate_store).
  contactLabel: '이메일',
  contactValue: 'cristianojun@naver.com',
} as const;

export function formatKrw(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}
