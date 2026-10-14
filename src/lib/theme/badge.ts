import { type TextStyle, type ViewStyle } from 'react-native';

import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 작은 배지 — 글자 12 · 알약 · 위아래 3(2026-10-14 사용자 결정 A안).
 * 글자 10/11/12.5, 모서리 알약/6 으로 갈라져 폰에서 읽기 어려웠다. 색은 각 배지가 정한다.
 * 시안 = 기획/ux/검색창_데모_2026-10-14.html §6.
 */
export const BadgeStyles = {
  box: { paddingVertical: 3, paddingHorizontal: Space.sm, borderRadius: Radius.pill, flexShrink: 0 } as ViewStyle,
  text: { fontSize: 12, fontWeight: '800' } as TextStyle,
};
