// storesPane.ts — 본사 매장 화면 2단(목록 + 상세)의 폭 판정. `hq/stores/_layout`(어느 쪽을 그리나)과
// `hq/stores/[id]`(닫기 ✕ 냐 뒤로 ← 냐)가 **같은 기준**을 봐야 해서 한 곳에 둔다.
//
// ★`components/shell/TwoPane` 을 쓰지 않는다 — `useShell() === 'owner-web'` 조건이라 본사 셸에서는 늘 false 다.
import { useWindowDimensions } from 'react-native';

import { SIDE_NAV_WIDTH, HQ_PAGE_GUTTER } from '@/lib/theme/layout';

/** 상세 칸 폭 — 예전 드로어 폭(392) 그대로. 상세 섹션들은 이 폭에 맞춰 짜여 있다. */
export const HQ_STORE_DETAIL_WIDTH = 392;

/**
 * 목록 칸 최소 폭 = 매장 표(6열)가 가로 스크롤·머리글 줄바꿈 없이 들어가는 폭.
 * 근거(2026-10-01 헤드리스 Chrome 으로 앱을 띄워 실측, Pretendard · 글자 크기 '보통'):
 *  · 고정 열 = 매장 220 + 관계 96 + 공개 수준 150 = 466
 *    (관계는 width 80 이지만 표 공용 셀의 minWidth 96 이 이긴다 — 실측 96)
 *  · 나머지 3열(직원·미해결 질문·숙지율)은 flexBasis 0 으로 **똑같이** 나눠 갖는다. 가장 넓은 머리글
 *    '미해결 질문' = 글자 65.8 + 간격 4 + 정렬 아이콘 12 + 좌우 패딩 32 = 113.8 → 세 열 × 114 = 342
 *    (열 폭 112 에서 두 줄로 접히고 115 에서 한 줄 — 실측)
 *  · 표 = 466 + 342 + 테두리 2 = 810 · 페이지 거터 32 × 2 · 세로 스크롤바(Windows, 매장이 많을 때) 15 → 889
 * 글자 크기 '크게'에서는 머리글이 접힐 수 있다(설정의 전역 배율). 열을 바꾸면 이 값을 다시 잰다.
 */
export const HQ_STORE_LIST_MIN_WIDTH = 810 + HQ_PAGE_GUTTER * 2 + 15;

/** 창 폭이 이 이상이면 목록 + 상세 두 단. 사이드바 240 + 목록 889 + 상세 392 = 1521. */
export const HQ_STORES_TWO_PANE_MIN = SIDE_NAV_WIDTH + HQ_STORE_LIST_MIN_WIDTH + HQ_STORE_DETAIL_WIDTH;

export function useStoresTwoPane(): boolean {
  return useWindowDimensions().width >= HQ_STORES_TWO_PANE_MIN;
}
