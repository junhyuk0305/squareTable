/**
 * 로그인한 사람의 첫 화면(Q27). 프로필 완성 · 다운그레이드 판정 **다음**에 부른다.
 *
 * - 본사 담당자는 본사 대시보드가 홈이다(/hq).
 * - 단, 본사 화면이 없는 스토어 앱(`hqConsole=false`)에서 자기 매장도 있으면 /hub 로 간다.
 *   매장이 없으면 /hq 의 안내 한 장을 그대로 본다.
 * - `hasStore` 는 `stores`(= my_units, 작업실 제외 · 0209)로 센다. `unitId` 는 작업실일 수 있다(0215).
 */
export type Landing = '/hq' | '/hub';

export function landingFor({ brandId, hqConsole, hasStore }: { brandId: string | null; hqConsole: boolean; hasStore: boolean }): Landing {
  if (!brandId) return '/hub';
  if (!hqConsole && hasStore) return '/hub';
  return '/hq';
}

export const HQ_TO_STORE_LABEL = '내 매장으로';
