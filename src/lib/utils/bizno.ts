// lib/utils/bizno.ts — 한국 사업자등록번호 포맷·체크섬 검증.
// 형식: 3-2-5 (XXX-XX-XXXXX). 마지막 자리는 검증 숫자(국세청 가중치 알고리즘).

// 입력 중 자동 하이픈(입력 마스크). 숫자만 추려 최대 10자리.
export function formatBizNo(raw: string): string {
  const d = raw.replace(/[^0-9]/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export function bizDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

// 체크섬 검증 — 가중치 [1,3,7,1,3,7,1,3,5] + 9번째 자리 보정.
export function isValidBizNo(raw: string): boolean {
  const d = bizDigits(raw);
  if (d.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[9]);
}
