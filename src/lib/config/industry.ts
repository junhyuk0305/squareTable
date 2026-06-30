// 매장 업종 — 신규 매장에 업종 표준 노하우팩을 매칭하는 키(콜드스타트).
// 가입(signup)·프로필 편집(account-edit) 공용. 목록이 갈라지지 않도록 단일 진실.
export const INDUSTRIES = [
  '카페·디저트',
  '음식점·식당',
  '주점·바',
  '베이커리',
  '분식·패스트푸드',
  '편의점·소매',
  '미용·뷰티',
  '기타',
] as const;

export type Industry = (typeof INDUSTRIES)[number];
