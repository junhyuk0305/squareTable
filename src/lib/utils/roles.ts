// 역할 판정 SSOT(0093 매니저 도입) — "매장 안 운영" 권한 판정은 이 헬퍼 하나만 쓴다.
// 매니저 = 사장 화면 표면을 공유하는 매장별 승격 역할(unit_members.role 정본).
// ⚠️ 사장 전용 영역(결제·매장 존재·임명·내보내기)은 이 헬퍼를 쓰지 말고 role === 'owner' 를 그대로 쓴다.
export const canManage = (role: string): boolean => role === 'owner' || role === 'manager';
