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

  // 오늘 한눈에 — 3칸 KPI(할일·공지·근무). 각 칸 동일 크기로 스캔.
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
  // 할일이 남았을 때만 노란 틴트로 '아직 할 게 있음'을 약하게 강조(액센트).
  kpiHi: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellowDeep },
  kpiValue: { fontSize: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5, lineHeight: 24 },
  kpiUnit: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  kpiLabel: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  // 교대 요청이 들어와 있으면 근무 칸 우상단에 빨간 점.
  kpiDot: { position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: BrandColors.accent },

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

  // 안 읽은 공지 — 한 줄 미리보기 strip(면적 최소·내용 보존). 노란 좌측바로 공지임을 표시.
  noticeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 3,
    borderLeftColor: BrandColors.yellowDeep,
    paddingVertical: 11,
    paddingHorizontal: 13,
    ...Elevation.e1,
  },
  noticeStripText: { flex: 1, fontSize: 13, fontWeight: '700', color: InkColors.ink },
  noticeStripMore: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

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
  // 진짜 입력처럼 보이는 흰 바 + 우측 노란 전송 버튼(탭하면 물어보기 탭으로 진입).
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    ...Elevation.e1,
  },
  askBarText: { flex: 1, fontSize: 14, color: InkColors.ink3, fontWeight: '600' },
  // 전송 버튼 = 노랑 원형 + 검정 화살표(옐로 글로우). 입력창의 주인공 액션 자리.
  askSend: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    ...Elevation.ey,
  },
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
});
