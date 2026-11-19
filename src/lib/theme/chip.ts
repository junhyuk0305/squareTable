import { type TextStyle, type ViewStyle } from 'react-native';

import { TouchSize } from '@/lib/theme/button';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 고르는 칩 — 고르면 검정 채움 + 흰 글자(2026-10-14 사용자 결정: A안 모양).
 * 높이 = 칩 누르는 크기 TouchSize.chip 40(2026-11-02 · ui.md 누르는 영역 · 크롤러 R3 도 칩 40). 옛 34 는 누르는 크기에 못 미쳤다(2026-11-19).
 * 테두리만 검정이던 칩은 골랐는지 잘 안 보였다. 시안 = 기획/ux/검색창_데모_2026-10-14.html §5.
 */
export const ChipStyles = {
  chip: {
    minHeight: TouchSize.chip,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    flexShrink: 0,
  } as ViewStyle,
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink } as ViewStyle,
  text: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 } as TextStyle,
  textOn: { color: InkColors.bubbleText, fontWeight: '800' } as TextStyle,
};
