import { StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

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
  choiceMark: { fontSize: 12, fontWeight: '900' },

  /** 진행 표시(3 / 8) — 보조 텍스트라 15sp 하한 대상 아님 */
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  progressText: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },

  /** 게임형 카드(지뢰 밟기·빠른 판별) */
  card: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { fontSize: 17, fontWeight: '800', color: InkColors.ink, lineHeight: 25, textAlign: 'center' },

  /** 한 줄 조작 안내(설계 07-29 목업의 그 한 줄 — 튜토리얼 화면 대신) */
  hint: { fontSize: 15, fontWeight: '700', color: InkColors.ink3, textAlign: 'center', lineHeight: 22 },

  btnRow: { flexDirection: 'row', gap: Space.sm },
  /** 화면당 1개만 쓰는 채움 버튼 */
  btnPrimary: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: InkColors.ink,
  },
  btnPrimaryText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
  btnSoft: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  btnSoftText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },

  /** 남은 시간 막대(빠른 판별) — 자체 Animated 대신 상태로 폭만 바꾼다 */
  timerTrack: { height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  timerFill: { height: 6, borderRadius: Radius.pill, backgroundColor: BrandColors.yellowDeep },

  /** 짝·순서에서 쓰는 번호 배지 */
  badge: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    color: InkColors.ink2,
  },
});
