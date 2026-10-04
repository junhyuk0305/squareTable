// sessionRole.ts — 세션 역할(매장 권한) 판정 SSOT (2026-10-04 사용자 규칙)
//
// 세션 role = **활성 매장의 멤버십 역할**(unit_members.role, my_units 로 로드)이다.
// 서버 0233 의 auth_is_owner·auth_can_manage 와 같은 정의다.
// profiles.role 은 '사장으로 가입했나'(계정 유형)일 뿐이라 매장 권한에 쓰지 않는다.
// 쓰면 A매장 사장이 직원으로 합류한 B매장에서 사장 화면을 본다(서버는 거부한다).
//
// 순수함수(무의존)라 node 타입 스트립으로 진리표를 회귀 테스트한다(scripts/qa-session-readfail.mjs · npm run qa:session).

export type StoreRole = 'owner' | 'manager' | 'junior';

/**
 * 활성 매장에서의 내 역할.
 * - rows = my_units 결과. null 이면 읽기 실패다.
 * - 활성 매장이 없거나 그 매장 행이 없으면 junior 다(fail-closed — 권한이 새는 쪽이 아니라 잠기는 쪽).
 *   본사 작업실은 my_units 에서 빠지므로 작업실이 활성이면 junior 다. 본사 화면은 brandId 로 가른다.
 * - 읽기 실패면 같은 사용자·같은 매장의 직전 역할을 유지한다. 폴링 한 번 실패로 사장이 직원 화면으로 튕기지 않게.
 *   계정이나 매장이 바뀌었으면 직전 역할은 근거가 아니다 → junior.
 * - createdUnitId = 이번 로드에서 막 만든 매장. create_store 가 owner 멤버십을 넣으므로 목록을 못 읽어도 owner 다.
 */
export function deriveStoreRole(args: {
  userId: string;
  unitId: string;
  rows: { unit_id: string; role: string }[] | null;
  prior: { userId: string; unitId: string; role: StoreRole };
  createdUnitId?: string;
}): StoreRole {
  const { userId, unitId, rows, prior, createdUnitId } = args;
  if (!unitId) return 'junior';
  if (rows) {
    const r = rows.find((s) => s.unit_id === unitId)?.role;
    return r === 'owner' || r === 'manager' ? r : 'junior';
  }
  if (createdUnitId && createdUnitId === unitId) return 'owner';
  if (prior.userId === userId && prior.unitId === unitId) return prior.role;
  return 'junior';
}
