import { type TextStyle, type ViewStyle } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 누르는 영역 — 요소마다 다르다(2026-11-02 사용자 결정 · 기준표 = 산출물/디자인시스템비교_2026-11-02/근무표시안_누르는영역_2026-11-02.html 2부).
 * 보이는 크기와 누르는 크기를 나눈다. RN-web 은 hitSlop 을 무시하므로 누르는 상자는 바깥 Pressable 의 minHeight/minWidth 로 키운다.
 *  · inlineFace 32 = 줄 안 작은 버튼(승인·거절·내보내기·매니저 지정)과 상단바 작은 알약(매장 토글·알림 종·전체 읽음)의 보이는 높이
 *  · inline 44 = 위 둘과 글자 링크(건너뛰기·전체 선택·되돌리기)의 누르는 높이
 *  · chip 40 = 칩·요일 원의 누르는 크기. 요일 7개가 한 줄에 서야 해서 44 대신 40
 */
export const TouchSize = { inlineFace: 32, inline: 44, chip: 40 } as const;

/** 누르는 상자를 키워도 줄 높이는 그대로 두는 위아래 음수 여백. 상자는 자리를 보이는 높이(face)만큼만 차지한다. */
export const hitTrim = (face: number, hit: number = TouchSize.inline) => (face - hit) / 2;

/**
 * 버튼 모양 — 색은 각 화면이 정한다(검정, 어두운 면 위에서는 노랑).
 *  · primary(주 버튼): 높이 52 · 모서리 16 · 가로 꽉(2026-10-14 사용자 결정 A안 · 2026-11-02 가로 꽉 확정).
 *    모서리 12/14/16/알약, 높이 50/52/56 으로 갈라져 있었다. 시안 = 기획/ux/검색창_데모_2026-10-14.html §4.
 *    빈 화면 버튼도 가로 꽉이다(2026-11-02).
 *  · small(작은 버튼): 높이 44 · 좌우 16 · 알약 · 내용 폭. 예 = 홈 '할일 등록하기'.
 *    2026-11-02 사용자 결정: 48·좌우 20 → 44·좌우 16 으로 조금 줄인다(글자 15/800 그대로).
 *  · inlineHit(누르는 상자 44): 줄 안 작은 버튼·상단바 작은 알약·글자 링크의 바깥 Pressable. 보이는 모양은 안쪽 View 가 든다.
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
    minHeight: 44,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.lg,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  inlineHit: {
    minHeight: TouchSize.inline,
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
