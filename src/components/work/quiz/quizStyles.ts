import { StyleSheet } from 'react-native';

import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Type } from '@/lib/theme/type';

/**
 * 응시 화면 형태 렌더러 공용 스타일.
 * 13개 형태가 같은 손맛을 갖도록 카드·버튼·정답표시를 한 곳에서 정의한다(형태별 드리프트 방지).
 * 규칙: 터치 타깃 ≥48dp · 본문 ≥15sp · 텍스트 상자는 minHeight(고정 height 금지).
 */
export const qs = StyleSheet.create({
  wrap: { gap: Space.sm },

  /** 상황·왼쪽 항목처럼 문제 위에 크게 얹는 전제 카드 */
  prelude: {
    borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56,
    justifyContent: 'center',
  },
  preludeText: { fontSize: 17, fontWeight: '800', color: InkColors.ink, lineHeight: 25 },

  /** 초성처럼 크게 띄우는 글자 */
  bigLetters: {
    fontSize: 30,
    fontWeight: '900',
    color: InkColors.ink,
    letterSpacing: 8,
    textAlign: 'center',
    lineHeight: 42,
  },

  /** 선택지 한 줄 */
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 52,
    backgroundColor: InkColors.bg,
  },
  choiceOn: { borderColor: InkColors.ink, backgroundColor: InkColors.bgSoft },
  choiceRight: { borderColor: BrandColors.good, backgroundColor: '#E6F1EA' },
  choiceWrong: { borderColor: BrandColors.bad, backgroundColor: '#FBECEC' },
  choiceText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22, minWidth: 0 },
  choiceMark: { ...Type.tag, fontWeight: '900' },

  /** 진행 표시(3 / 8) — 보조 텍스트라 15sp 하한 대상 아님 */
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  progressText: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },

  /** 게임형 카드(지뢰 밟기·빠른 판별) — 모서리 16(2026-11-02 모서리 20 폐지) */
  card: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { fontSize: 17, fontWeight: '800', color: InkColors.ink, lineHeight: 25, textAlign: 'center' },

  /** 한 줄 조작 안내(설계 07-29 목업의 그 한 줄 — 튜토리얼 화면 대신) */
  hint: { ...Type.desc, fontWeight: '700', textAlign: 'center' },

  btnRow: { flexDirection: 'row', gap: Space.sm },
  /** 화면당 1개만 쓰는 채움 버튼 — 주 버튼 모양(52 · 모서리 16 · 16/800). 줄에서 나눠 쓰려고 flex 1. */
  btnPrimary: {
    ...ButtonStyles.primary,
    flex: 1,
    backgroundColor: InkColors.ink,
  },
  btnPrimaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  btnSoft: {
    ...ButtonStyles.primary,
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  btnSoftText: { ...ButtonTextStyles.primary, color: InkColors.ink },

  /** 남은 시간 막대(빠른 판별) — 자체 Animated 대신 상태로 폭만 바꾼다 */
  timerTrack: { height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  timerFill: { height: 6, borderRadius: Radius.pill, backgroundColor: BrandColors.yellowDeep },

  /** 짝·순서에서 쓰는 번호 배지 */
  badge: {
    ...Type.tag,
    minWidth: 22,
    textAlign: 'center',
    fontWeight: '900',
    color: InkColors.ink2,
  },
});
