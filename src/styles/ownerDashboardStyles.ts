import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  // 스크롤 컨테이너는 패딩만 — 섹션 간격(gap)은 단일 자식인 콘텐츠 래퍼(scrollInner)가 갖는다.
  // (contentContainer는 자식이 하나라 gap이 무효 → 래퍼로 일원화해 중복/혼동 제거)
  scroll: { padding: 20 },
  scrollInner: { gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },
  // 섹션: [밖 라벨] + [안 카드] 묶음
  section: { gap: 8 },

  // 미검증 우선 배너는 공용 <AlertRow>(블록 X2)로 대체됨(2026-08-05).

  // 상단 커스텀 헤더 — 좌측 로고 / 우측 매장명·사용자명
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
    backgroundColor: InkColors.cream,
  },
  // 헤더: [매장 토글(⌂ 허브 복귀 + 전환)][알림 벨]
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  onboard: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#E8C9C2',
    padding: 20,
    gap: 8,
    alignItems: 'flex-start',
  },
  onboardTitle: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  onboardBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  onboardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: BrandColors.brand,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
  },
  onboardCtaText: { color: InkColors.bubbleText, fontSize: 14, fontWeight: '800' },
  seedLabel: { fontSize: 12, color: InkColors.ink2, fontWeight: '700', marginTop: 12 },
  seedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  seedChip: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  seedChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  // 히어로는 공용 <InboxHeroCard>(블록 H4), KPI 2칸은 <MiniStats>(블록 I3)로 대체됨(2026-08-05).

  // 답 기다리는 질문이 0건일 때의 조용한 카드 — 빈 화면을 안내로 위장하지 않고 다음 행동을 준다.
  quietCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.xl,
    gap: Space.xs,
    ...Elevation.e1,
  },
  quietTitle: { fontSize: 17, lineHeight: 24, fontWeight: '800', color: InkColors.ink },
  quietSub: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: InkColors.ink2 },
  quietCta: { marginTop: Space.sm, fontSize: 15, fontWeight: '800', color: InkColors.ink },

  // ⑤ 오늘 업무 3건 — 섹션 라벨은 카드 밖, 목록은 카드 안.
  moreLink: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  taskCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    ...Elevation.e1,
  },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.sm },
  taskRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  taskText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  taskTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },

  miniRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  miniLink: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
});
