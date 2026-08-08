// 역할 판정 SSOT(0093 매니저 도입) — "매장 안 운영" 권한 판정은 이 헬퍼 하나만 쓴다.
// 매니저 = 사장 화면 표면을 공유하는 매장별 승격 역할(unit_members.role 정본).
// ⚠️ 사장 전용 영역(결제·매장 존재·임명·내보내기)은 이 헬퍼를 쓰지 말고 role === 'owner' 를 그대로 쓴다.
export const canManage = (role: string): boolean => role === 'owner' || role === 'manager';

/**
 * 역할 호칭 SSOT — 사람 이름 뒤에 붙는 말. "○○ 사장님 / ○○ 매니저 / ○○님".
 *
 * ★왜 필요한가: 매니저는 사장 화면 세트를 그대로 쓰기 때문에, 화면에 "사장님"을 하드코딩하면
 *   매니저가 자기 자신을 사장으로 부르는 표기가 된다(2026-08-08 알림 화면에서 실제 발생).
 *   호칭이 필요한 자리는 전부 여기를 거친다 — 저자 표기(knowhowSource)·정체성 카드·명부 배지.
 * 직원은 역할명을 붙이지 않는다("이수민 직원"은 우리가 쓰는 말이 아니다) → "○○님".
 */
export function honorific(name: string, role: string): string {
  const n = name?.trim() || '나';
  if (role === 'owner') return `${n} 사장님`;
  if (role === 'manager') return `${n} 매니저`;
  return `${n}님`;
}

/** 역할 이름만(배지·목록 힌트용). 호칭이 아니라 명사다. */
export const roleNoun = (role: string): string =>
  role === 'owner' ? '사장' : role === 'manager' ? '매니저' : '직원';

export type MemberRole = 'owner' | 'manager' | 'junior';
/** DB에서 온 역할 문자열을 3종으로 좁힌다. 모르는 값은 **직원**으로 — 권한이 새는 방향이 아니라
 *  잠기는 방향(fail-closed). 세션 역할 파생(useSessionStore)과 같은 원칙. */
export const asMemberRole = (role: string | null | undefined): MemberRole =>
  role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : 'junior';
