// 매장 색 — 직원이 여러 매장을 구분하도록 카드·알림에 붙이는 색.
// 기본은 unit_id 해시로 팔레트에서 결정론적으로 자동 배정(같은 매장=항상 같은 색), 사용자가 매장 설정에서 덮어쓰면 그 값.
// (색은 unit_member_prefs.color 에 저장 — 개인화라 사용자마다 다를 수 있다.)

// 서로 잘 구분되는 8색(라이트 배경에서 텍스트/보더로 무난). 디자인 팔레트와 한 가족 톤.
export const STORE_COLORS = [
  '#3E92D9', // 블루
  '#F26A50', // 코랄
  '#2FAF6B', // 그린
  '#F2A83C', // 앰버골드
  '#8A63D2', // 퍼플
  '#D2637F', // 로즈
  '#2FA79B', // 틸
  '#C77D3A', // 브론즈
] as const;

/** unit_id 를 팔레트 인덱스로(문자 코드 합 — 안정적·결정론적). */
function hashIndex(unitId: string): number {
  let sum = 0;
  for (let i = 0; i < unitId.length; i++) sum = (sum + unitId.charCodeAt(i)) % STORE_COLORS.length;
  return sum;
}

/** 매장 색 — 저장된 override 가 있으면 그걸, 없으면 unit_id 해시 자동색. */
export function storeColor(unitId: string, override?: string | null): string {
  if (override && override.trim()) return override.trim();
  return STORE_COLORS[hashIndex(unitId)];
}
