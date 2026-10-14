import { type ViewStyle } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 목록 카드 모양 — 흰 면 · 모서리 16 · 그림자 e1 · 안쪽 16(2026-10-14 사용자 결정 A안).
 * 화면마다 모서리 16/20 · 그림자 없음/e1/e2 · 안쪽 14/16/20 으로 갈라져 있었다.
 * 시안 = 기획/ux/검색창_데모_2026-10-14.html §3. 화면 StyleSheet 에서 펼쳐 쓴다(`...CardStyles.list`).
 */
const base: ViewStyle = {
  backgroundColor: InkColors.bg,
  borderRadius: Radius.md,
  borderWidth: 1,
  borderColor: InkColors.line,
  ...Elevation.e1,
};

export const CardStyles = {
  /** 내용 카드 — 사방 16. */
  list: { ...base, padding: Space.lg } as ViewStyle,
  /** 행 목록 카드 — 좌우 16만. 위아래는 각 행이 자기 여백을 갖는다. */
  rows: { ...base, paddingHorizontal: Space.lg } as ViewStyle,
};
