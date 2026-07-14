// 프로필 완성 필요 판정 — SSOT.
// 소셜 로그인(구글 등)은 가입 폼을 안 거쳐 handle_new_user 트리거가 phone/birth_date=null 인 결손 프로필을
// 만든다. 이 상태로는 create_store/join_by_invite 가 birth_date_required 로 막혀 사용자가 갇힌다.
// → '완성화면(/complete-profile)'으로 유도해 name/phone/birth_date(+사장은 매장)를 채우게 한다.
//
// 감지 신호로 phone 을 쓰는 이유: birth_date 는 클라가 못 읽는다(0065 컬럼 그랜트 제외). 반면 이메일 가입은
// phone 이 필수라 항상 채워지고 트리거가 기록한다 → phone 이 비어 있으면 '가입 폼을 안 거친 계정'이다.
// unit/pending 이 있으면 이미 온보딩을 통과한 것이므로 제외(기존 사용자를 완성화면으로 오유도하지 않는다).
//
// 순수 함수라 회귀 테스트로 진리표를 고정할 수 있다(qa:profile-setup).
export function needsProfileSetup(s: {
  status: string;
  phone: string;
  unitId: string;
  pendingUnitId: string;
}): boolean {
  return s.status === 'signed_in' && !s.phone && !s.unitId && !s.pendingUnitId;
}
