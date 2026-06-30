import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  scroll: { padding: 20, gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  // 섹션: [밖 라벨] + [안 카드] 묶음. scroll의 gap이 섹션 사이를 벌리고, 이 gap이 라벨↔카드를 붙인다.
  section: { gap: 8 },
  // 섹션 라벨 — 카드 밖(위)
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  sectionLabelText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2, letterSpacing: -0.2 },
  sectionLabelTrailing: { marginLeft: 'auto' },
  // 2열 행
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 8 },
  cardFill: { flex: 1 },
  // 카드 하단 보조행(설명 + chevron)
  cardFootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  countPill: {
    fontSize: 12,
    fontWeight: '800',
    color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  // 오늘 할일 전부 완료 → 노란 틴트로 '착착 끝남' 작은 보상(액센트).
  countPillDone: { backgroundColor: BrandColors.yellowSoft, color: InkColors.ink },

  // 출퇴근
  clockCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 22,
    alignItems: 'center',
    gap: 6,
    ...Elevation.e1,
  },
  workingTag: { fontSize: 13, fontWeight: '800', color: BrandColors.accent },
  clockTime: { fontSize: 38, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  clockReady: { fontSize: 19, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3, marginTop: 2 },
  clockSub: { fontSize: 14, color: InkColors.ink3, fontWeight: '600', marginBottom: 4 },
  // 오늘 번 돈 — 페이백 강조(P4)
  payRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  payLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
  payValue: { fontSize: 24, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  clockBtn: { width: '100%', paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  clockBtnBig: { paddingVertical: 20, borderRadius: Radius.lg },
  // 출근 = 가장 자주 누르는 주인공 액션 → 브랜드 옐로 + 검정 글씨 + 옐로 글로우(액센트의 핵심 자리).
  clockBtnIn: { backgroundColor: BrandColors.yellow, ...Elevation.ey },
  // 퇴근 = '멈춤' 보조 액션 → 차분한 잉크 블랙(옐로 1차 버튼과 위계 분리).
  clockBtnOut: { backgroundColor: BrandColors.brand },
  clockBtnText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
  clockBtnTextIn: { color: InkColors.ink }, // 옐로 면 위 텍스트는 검정(대비 확보)
  clockBtnTextBig: { fontSize: 18 },
  clockMore: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 8 },
  clockMoreText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },

  // 안 읽은 공지
  noticeCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    padding: 18,
    gap: 8,
    ...Elevation.e1,
  },
  noticeBadge: {
    marginLeft: 'auto',
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBadgeText: { fontSize: 12, fontWeight: '900', color: InkColors.bubbleText },
  noticeBody: { fontSize: 14, color: InkColors.ink, fontWeight: '600', lineHeight: 21 },
  noticeSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

  // 오늘 할일 (2열 컴팩트)
  taskCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    gap: 10,
    justifyContent: 'center',
    ...Elevation.e1,
  },
  bar: { height: 8, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  taskSub: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  // 이번 주 근무표 (2열 컴팩트)
  schedCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    gap: 4,
    justifyContent: 'center',
    ...Elevation.e1,
  },
  schedBadge: { backgroundColor: BrandColors.accent, paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.pill },
  schedBadgeText: { fontSize: 11, fontWeight: '800', color: InkColors.bubbleText },
  schedSub: { fontSize: 14, color: InkColors.ink, fontWeight: '700', lineHeight: 20 },
  schedHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', lineHeight: 17 },

  // 노하우 묻기
  askCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 18,
    gap: 10,
    ...Elevation.e1,
  },
  askSub: { fontSize: 13, color: InkColors.ink3, lineHeight: 19 },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.pill,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 8,
  },
  // 검색 진입 아이콘 = 노란 배지 위 검정 아이콘(옐로+다크 모티프) — 탭을 부르는 작은 액센트.
  askIconBadge: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askBarText: { fontSize: 14, color: InkColors.ink3, fontWeight: '600' },
  askChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  askChip: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  askChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  // 많이 물어본 노하우 (랭킹 리스트) — 순위 + 카테고리색 점 + 제목 + 노랑 인용수 칩
  popularCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 16,
    ...Elevation.e1,
  },
  popularRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13 },
  popularRowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  popularRank: { fontSize: 15, fontWeight: '900', color: InkColors.ink, width: 14, textAlign: 'center' },
  popularDot: { width: 8, height: 8, borderRadius: Radius.pill },
  popularTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: InkColors.ink },
  // 인용수 칩 = 노랑 소프트 틴트 + 검정(완료/달성 톤) — 화면 액센트 보강.
  popularHits: {
    fontSize: 11,
    fontWeight: '800',
    color: InkColors.ink,
    backgroundColor: BrandColors.yellowSoft,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
});
