import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  // 스크롤 컨테이너는 패딩만 — 섹션 간격(gap)은 단일 자식인 콘텐츠 래퍼(scrollInner)가 갖는다.
  // (contentContainer는 자식이 하나라 gap이 무효 → 래퍼로 일원화해 중복/혼동 제거)
  scroll: { padding: 20 },
  scrollInner: { gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },
  // 섹션: [밖 라벨] + [안 카드] 묶음
  section: { gap: 8 },

  // 미검증 우선 배너(홈 최상단) — 검증 필요 강도를 레드 액센트로
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: BrandColors.accentSoft,
    borderWidth: 1,
    borderColor: BrandColors.bad,
    borderRadius: Radius.md,
    padding: 14,
  },
  reviewIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  reviewSub: { fontSize: 12, color: InkColors.ink2, marginTop: 2, lineHeight: 17 },
  reviewCta: { fontSize: 13, fontWeight: '800', color: BrandColors.bad },

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

  onboard: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#E8C9C2',
    padding: 20,
    gap: 8,
    alignItems: 'flex-start',
  },
  onboardEmoji: { fontSize: 34 },
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

  // ① 받은질문 히어로 (사령탑 주인공)
  hero: { backgroundColor: InkColors.ink, borderRadius: Radius.lg, padding: 18, gap: 7, ...Elevation.e2 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroKicker: { fontSize: 13, fontWeight: '800', color: InkColors.bubbleText, letterSpacing: 0.3 },
  heroBadge: {
    marginLeft: 'auto',
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadgeText: { fontSize: 13, fontWeight: '900', color: InkColors.bubbleText },
  heroLead: { fontSize: 16, fontWeight: '700', color: InkColors.bubbleText, lineHeight: 23 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: InkColors.bg,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  heroCtaText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  // ② 오늘 한눈에 — 3칸 KPI(업무·근무·인건비). 동일 크기로 스캔. 인건비 칸만 노란 틴트로 강조.
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: {
    flex: 1,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 5,
    ...Elevation.e1,
  },
  kpiHi: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellowDeep },
  kpiValue: { fontSize: 21, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5, lineHeight: 24 },
  kpiUnit: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  kpiLabel: { fontSize: 11, fontWeight: '700', color: InkColors.ink3, textAlign: 'center' },

  miniRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  miniLink: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
});
