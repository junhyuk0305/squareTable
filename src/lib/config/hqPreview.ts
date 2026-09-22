/**
 * 본사 셸 QA 미리보기 — 브랜드 축(P2 `brand_members` · 세션 `brandId` 파생)이 아직 없어
 * 본사 담당자 세션을 만들 수 없다. 개발 빌드에서만, 브라우저 하니스가 미리 심어 둔
 * localStorage 플래그로 본사 셸과 `/hq/*` 라우트를 연다.
 *
 * ★`__DEV__` 가 false 인 프로덕션 웹 번들에서는 이 판정이 통째로 접힌다 —
 *   산출물에 플래그 문자열이 남지 않는 것을 `scripts/web-bundle-size.mjs` 가 확인한다.
 * 모듈 평가 시 1회만 읽는다(셸과 라우트 게이트가 같은 값을 봐야 한다).
 */
export const IS_HQ_PREVIEW: boolean =
  __DEV__ && typeof window !== 'undefined' && !!window.localStorage
    ? window.localStorage.getItem('st-hq-preview') === '1'
    : false;
