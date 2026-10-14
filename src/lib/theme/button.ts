import { type ViewStyle } from 'react-native';

import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 주 버튼 모양 — 모서리 16 · 높이 52(2026-10-14 사용자 결정 A안).
 * 모서리 12/14/16/알약, 높이 50/52/56 으로 갈라져 있었다. 색·글자는 각 화면이 정한다.
 * 시안 = 기획/ux/검색창_데모_2026-10-14.html §4. 화면 StyleSheet 에서 펼쳐 쓴다(`...ButtonStyles.primary`).
 */
export const ButtonStyles = {
  primary: {
    minHeight: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
};
