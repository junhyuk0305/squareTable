/**
 * 서비스 웹 주소 SSOT — 밖으로 나가는 링크(퀴즈 게스트 링크·직원 초대 링크)의 앞부분.
 *
 * ★하드코딩 금지. 도메인이 바뀌면 여기 한 줄만 고친다 — 두 곳에 복제하면 한쪽만 고쳐져
 *   **열리지 않는 링크**가 카톡으로 나간다(퀴즈 링크에서 이미 겪은 실패라 같은 규칙을 쓴다).
 */
import { Platform } from 'react-native';

/** 네이티브·SSR 폴백. 웹에서는 지금 열려 있는 주소를 우선한다(프리뷰 배포에서도 링크가 산다). */
export const SITE_ORIGIN = 'https://dochackchack.com';

/** 공유 URL 의 앞부분. 웹은 지금 열려 있는 주소, 네이티브는 서비스 도메인(딥링크 아님 — 브라우저로 연다). */
export function siteOrigin(): string {
  if (Platform.OS === 'web') {
    const g = globalThis as unknown as { location?: { origin?: string } };
    if (g.location?.origin) return g.location.origin;
  }
  return SITE_ORIGIN;
}
