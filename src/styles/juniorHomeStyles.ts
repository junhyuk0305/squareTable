import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  scroll: { padding: 20, gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  // 섹션: [밖 라벨] + [안 카드] 묶음. scroll의 gap이 섹션 사이를 벌리고, 이 gap이 라벨↔카드를 붙인다.
  section: { gap: 8 },
  // 섹션 라벨은 공용 <SectionLabel>을 쓴다 — 로컬 재구현본 폐기(2026-08-05).

  // 오늘 할 일(Primary) — 남은 개수 + 데이파트 칩 + 목록 3건을 한 카드에.
  todoCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  todoLead: { fontSize: 17, lineHeight: 24, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3 },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.xs },
  todoRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  todoText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  todoTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  todoEmpty: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: InkColors.ink2 },
  // 빈 상태 버튼은 **아웃라인**이다 — 같은 화면의 '퇴근하기'(검정 솔리드)와 겹치면
  // Primary가 2개로 보인다(복잡도 원칙: 화면당 Primary 1개).
  todoEmptyBtn: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.ink,
    backgroundColor: InkColors.bg,
  },
  todoEmptyBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  moreLink: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  // 오늘 한눈에 3칸 KPI는 공용 <MiniStats>(블록 I3)로 대체됨(2026-08-05).

  // 데이파트 완료 칩 — '오늘 할 일' 카드 안으로 이관(2026-08-05). 멘션 한 줄은 MiniStats 칸으로 압축.
  briefDayparts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: InkColors.cream,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  // 완료된 데이파트 = 초록 틴트 + 체크(다 했음을 한눈에).
  dpChipDone: { backgroundColor: '#E6F1EA', borderColor: BrandColors.good },
  dpChipText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  dpChipTextDone: { color: BrandColors.goodText },

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
  workingTag: { fontSize: 13, fontWeight: '800', color: BrandColors.accentText },
  clockTime: { fontSize: 38, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  clockReady: { fontSize: 19, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3, marginTop: 2 },
  clockSub: { fontSize: 14, color: InkColors.ink3, fontWeight: '600', marginBottom: 4 },
  // 오늘 번 돈 — 페이백 강조(P4)
  payRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  payLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
  payValue: { fontSize: 24, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  clockBtn: { width: '100%', paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  clockBtnBig: { paddingVertical: 20, borderRadius: Radius.lg },
  // 출근 = ★2026-08-06 옐로 채움+글로우 → **아웃라인**으로 내렸다.
  //  이 화면의 Primary 는 '물어보기'(정본 §2 직원 표)인데, 실제로는 폭 100% 옐로 글로우 버튼인
  //  출근하기가 유일한 채운 버튼이라 1등석을 갖고 있었다(정본·주석·시각 위계가 셋 다 달랐다).
  //  위치·크기(첫 출근 전 clockBtnBig)는 그대로라 못 찾을 일은 없다.
  clockBtnIn: { backgroundColor: InkColors.bg, borderWidth: 1.5, borderColor: InkColors.ink },
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

  // 노하우 묻기 — ★2026-08-06: 카드를 벗겼다(카드 아닌 블록).
  //  ① 할 일·물어보기·출퇴근 세 카드가 같은 형태로 이어져 배치규칙①(연속 3회 금지) 위반이었다.
  //  ② 카드를 없앤 게 아니라 옮긴 것이다 — 이 화면의 카드는 '오늘 할 일'·'출퇴근' 2개가 남는다(규칙⑤).
  askBlock: { gap: 10 },
  askSub: { fontSize: 13, color: InkColors.ink3, lineHeight: 19 },
  // ★Primary — 이 화면에서 유일한 '채운' 버튼(복잡도 원칙: 화면당 Primary 1개).
  //  직전까지는 가짜 입력창(회색 placeholder + 32px 노란 전송 원)이라 위계가 보조로 읽혔고,
  //  탭해도 입력이 안 되는 가짜였다. 누르면 이동하는 것이므로 버튼으로 정직하게 그린다.
  askPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.yellow,
    ...Elevation.ey,
  },
  askPrimaryText: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
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
