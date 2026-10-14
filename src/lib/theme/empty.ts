import { type TextStyle, type ViewStyle } from 'react-native';

import { CardStyles } from '@/lib/theme/card';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/**
 * 비어 있을 때 — 카드 안 흐린 글자 한 줄(2026-10-14 사용자 결정 A안).
 * 흰 상자·글자만·이모지 큰 안내가 섞여 있어 어떤 건 오류처럼 보였다. 시안 = 기획/ux/검색창_데모_2026-10-14.html §2.
 * 이미 목록 카드 안이면 `line` 만, 카드가 없는 자리면 `box` 로 감싸고 그 안에 `text`.
 */
export const EmptyStyles = {
  box: { ...CardStyles.list, paddingVertical: Space.gutter, alignItems: 'center', gap: Space.sm } as ViewStyle,
  text: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', lineHeight: 22 } as TextStyle,
  line: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', lineHeight: 22, paddingVertical: Space.gutter } as TextStyle,
};
