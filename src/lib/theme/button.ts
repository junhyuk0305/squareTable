import { type TextStyle, type ViewStyle } from 'react-native';

import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 버튼 모양 — 색은 각 화면이 정한다(검정, 어두운 면 위에서는 노랑).
 *  · primary(주 버튼): 높이 52 · 모서리 16 · 가로 꽉(2026-10-14 사용자 결정 A안 · 2026-11-02 가로 꽉 확정).
 *    모서리 12/14/16/알약, 높이 50/52/56 으로 갈라져 있었다. 시안 = 기획/ux/검색창_데모_2026-10-14.html §4.
 *    빈 화면 버튼도 가로 꽉이다(2026-11-02).
 *  · small(작은 버튼): 높이 48 · 알약 · 내용 폭(2026-11-02 사용자 결정). 예 = 홈 '할일 등록하기'.
 * 화면 StyleSheet 에서 펼쳐 쓴다(`...ButtonStyles.primary`, 글자는 `...ButtonTextStyles.primary`).
 */
export const ButtonStyles = {
  primary: {
    minHeight: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  small: {
    minHeight: 48,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.gutter,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
};

/** 버튼 글자 크기·굵기(2026-11-02 결정). 색은 화면이 정한다. */
export const ButtonTextStyles = {
  primary: { fontSize: 16, fontWeight: '800' } as TextStyle,
  small: { fontSize: 15, fontWeight: '800' } as TextStyle,
};
