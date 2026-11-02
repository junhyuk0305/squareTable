import { type ViewStyle } from 'react-native';

import { InkColors, Surface } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Layout } from '@/lib/theme/layout';

/**
 * 목록 카드 모양 — 흰 면 · 선 1px · 모서리 16 · 그림자 없음 · 안쪽 16.
 * 결정 이력:
 *  · 2026-10-14 사용자 결정 A안 — 화면마다 모서리 16/20 · 그림자 없음/e1/e2 · 안쪽 14/16/20 으로 갈라져 있던 것을
 *    흰 면 · 모서리 16 · 그림자 e1 · 안쪽 16 하나로 묶었다. 시안 = 기획/ux/검색창_데모_2026-10-14.html §3.
 *  · 2026-11-02 사용자 결정 — **그림자 없음.** 화면 바탕이 회색(Surface.screen)이 되면서 흰 면과 선만으로 카드가 갈린다.
 *    안쪽은 `Layout.cardPad` 를 읽는다.
 * 화면 StyleSheet 에서 펼쳐 쓴다(`...CardStyles.list`).
 */
const base: ViewStyle = {
  backgroundColor: Surface.card,
  borderRadius: Radius.md,
  borderWidth: 1,
  borderColor: InkColors.line,
};

export const CardStyles = {
  /** 내용 카드 — 사방 16. */
  list: { ...base, padding: Layout.cardPad } as ViewStyle,
  /** 행 목록 카드 — 좌우 16만. 위아래는 각 행이 자기 여백을 갖는다. */
  rows: { ...base, paddingHorizontal: Layout.cardPad } as ViewStyle,
};
