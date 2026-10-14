import { StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 검색창 모양 — 앱의 모든 검색창이 이것 하나를 쓴다(2026-10-14 사용자 결정 A안: 진한 테두리 알약).
 * 화면마다 모양이 4가지로 갈라졌고, 그중 퀴즈 만들기는 회색 면이 회색 화면 위에 놓여 칸이 안 보였다.
 * 흰 면 + lineStrong 테두리라 흰 화면·회색 화면 어디서든 칸이 보인다. 시안 = 기획/ux/검색창_데모_2026-10-14.html
 */
export const SearchStyles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    backgroundColor: InkColors.bg,
    borderWidth: 1.5,
    borderColor: InkColors.lineStrong,
    borderRadius: Radius.pill,
  },
  input: { flex: 1, fontSize: 15, color: InkColors.ink, paddingVertical: Space.sm },
});

/** 검색창 돋보기 아이콘 색·크기. */
export const SEARCH_ICON = { size: 18, color: InkColors.ink2 } as const;
