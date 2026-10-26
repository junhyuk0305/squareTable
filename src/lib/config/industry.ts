// 매장 업종 — 신규 매장에 업종 표준 노하우팩을 매칭하는 키(콜드스타트).
// 가입(signup)·프로필 편집(account-edit) 공용. 목록이 갈라지지 않도록 단일 진실.
// 고를 수 있는 업종은 카페·음식점 2개다(2026-10-24 사용자 결정 · 포지셔닝 = 음식점·카페).
// 예전 17개 값은 DB에 그대로 남는다(서버는 값을 검사하지 않고 옛 앱이 계속 보낸다). 팩·챕터 매핑은 옛 값도 계속 읽는다.
export const INDUSTRIES = ['카페·디저트', '음식점·식당'] as const;

// 옛 영문 업종 코드 → 화면 이름. 예전 앱이 팩 매칭 키(fnb)를 그대로 저장한 매장이 있다. cafe 는 로컬 시드(qa-c-local-seed) 값.
const LEGACY_CODE_LABEL: Record<string, string> = { fnb: '음식점·식당', cafe: '카페·디저트' };

/** 저장된 업종 → 화면에 보일 이름. 한글 값은 그대로, 아는 영문 코드는 바꾸고, 모르는 영문 코드는 null(개발 코드를 화면에 내지 않는다). */
export function industryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const label = LEGACY_CODE_LABEL[value] ?? value;
  return /[가-힣]/.test(label) ? label : null;
}

/** 홀·주방이 있는 음식점 계열 — 음식점 전용 노하우팩(restaurant)과 '주방·조리' 챕터가 붙는 업종. 배달전문은 홀이 없어 제외. 옛 값 포함. */
export const RESTAURANT_INDUSTRIES: string[] = [
  '브런치·양식',
  '음식점·식당',
  '한식·백반',
  '고깃집·구이',
  '치킨·호프',
  '분식·패스트푸드',
  '피자·버거',
  '중식',
  '일식·초밥',
  '주점·바',
];
