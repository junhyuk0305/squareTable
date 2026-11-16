import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Layout } from '@/lib/theme/layout';

/**
 * 상단 헤더 틀 — 모든 상단 헤더가 이 한 식을 읽는다(2026-11-16 사용자 결정 R-6 "모든 헤더 73").
 * 높이 = 위 안전 영역 + `Layout.headerH`. 위 안전 영역은 헤더가 든다(`<Screen>` 은 edges=[]).
 * 쓰는 곳: AppTopBar(탭 상단바) · ScreenTitleHeader(탭·상세 둘 다). 내용은 각 헤더가 세로 가운데 둔다.
 */
export function useHeaderFrame() {
  const insets = useSafeAreaInsets();
  return { paddingTop: insets.top, height: insets.top + Layout.headerH };
}
