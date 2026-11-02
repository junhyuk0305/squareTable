import { type TextStyle, type ViewStyle } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 버튼 모양 — 색은 각 화면이 정한다(검정, 어두운 면 위에서는 노랑).
 *  · primary(주 버튼): 높이 52 · 모서리 16 · 가로 꽉(2026-10-14 사용자 결정 A안 · 2026-11-02 가로 꽉 확정).
 *    모서리 12/14/16/알약, 높이 50/52/56 으로 갈라져 있었다. 시안 = 기획/ux/검색창_데모_2026-10-14.html §4.
 *    빈 화면 버튼도 가로 꽉이다(2026-11-02).
 *  · small(작은 버튼): 높이 48 · 알약 · 내용 폭(2026-11-02 사용자 결정). 예 = 홈 '할일 등록하기'.
 *  · iconCircle(흰 원 아이콘 버튼): 보이는 원 40 · 흰 면 · 선 lineStrong(2026-11-02 사용자 결정 · 근무표 주 이동·출근 기록 월 이동 화살표).
 *    누르는 상자 48 은 바깥 Pressable 이 minWidth/minHeight 48 로 든다(RN-web 은 hitSlop 을 무시한다).
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
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
};

/** 버튼 글자 크기·굵기(2026-11-02 결정). 색은 화면이 정한다. */
export const ButtonTextStyles = {
  primary: { fontSize: 16, fontWeight: '800' } as TextStyle,
  small: { fontSize: 15, fontWeight: '800' } as TextStyle,
};
