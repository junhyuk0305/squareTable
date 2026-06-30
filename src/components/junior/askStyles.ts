import { StyleSheet, Platform } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

/** '물어보기'(JuniorAsk) 챗 UI 스타일. */
export const styles = StyleSheet.create({
  // 상단 신원 바
  identityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  identityText: {
    flex: 1,
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '500',
  },
  suggestEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  suggestEntryText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },

  // 대화 영역
  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 4,
    gap: 18,
  },

  // 빈 상태 — 첫 진입 시 안내 + 추천 질문
  empty: {
    paddingTop: 28,
    paddingHorizontal: 4,
    gap: 10,
  },
  emptyTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' },
  // 노란 마커 = 글자 '뒤'에 깔리는 형광펜. Wordmark와 동일한 격리/zIndex 패턴.
  markerWrap: { position: 'relative', isolation: 'isolate' },
  markerBar: {
    position: 'absolute',
    left: -2,
    right: -2,
    bottom: 3,
    height: 11,
    backgroundColor: BrandColors.yellow,
    borderRadius: Radius.tail,
    zIndex: 0,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: InkColors.ink,
    letterSpacing: -0.3,
    zIndex: 1,
  },
  emptySub: {
    fontSize: 14,
    color: InkColors.ink3,
    lineHeight: 20,
    marginBottom: 8,
  },
  suggestLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0.3, marginBottom: 2 },
  suggestList: { gap: 10 },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  suggestText: {
    flex: 1,
    fontSize: 15,
    color: InkColors.ink2,
    fontWeight: '600',
  },
  suggestArrow: {
    fontSize: 15,
    color: BrandColors.yellowDeep, // 추천 질문 진입 화살표에 노란 포인트
    fontWeight: '900',
    marginLeft: 10,
  },

  // 로딩
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  loadingDot: {
    fontSize: 14,
    color: BrandColors.yellowDeep, // 검색 중 반짝임에 노란 포인트
    fontWeight: '800',
  },
  loadingText: {
    fontSize: 13,
    color: InkColors.ink2,
    fontWeight: '600',
  },

  // 전송 실패 배너
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.accentSoft,
    borderWidth: 1,
    borderColor: BrandColors.accent,
  },
  errorText: { flex: 1, fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  retryBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: Radius.pill, backgroundColor: BrandColors.accent },
  retryText: { fontSize: 12, fontWeight: '800', color: InkColors.bubbleText },
  errorClose: { fontSize: 14, fontWeight: '800', color: BrandColors.accent },

  // 추천 질문 상시 스트립 (대화 시작 후)
  chipStrip: { maxHeight: 44, backgroundColor: InkColors.bg },
  chipStripContent: { paddingHorizontal: 12, paddingTop: 8, gap: 8, alignItems: 'center' },
  chip: {
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  // 익명 토글
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: InkColors.bg,
  },
  anonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  anonChipOn: {
    backgroundColor: InkColors.ink,
    borderColor: InkColors.ink,
  },
  anonChipText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  anonChipTextOn: { color: InkColors.bubbleText },
  anonHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '500' },

  // 입력바
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingLeft: 16,
    paddingRight: 6,
    backgroundColor: InkColors.bg,
    minHeight: 46,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: InkColors.ink,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 켜짐 = 브랜드 옐로 + 옐로 글로우(보낼 준비됨). 검정 화살표로 대비 확보.
  sendBtnOn: {
    backgroundColor: BrandColors.yellow,
    ...Elevation.ey,
  },
  sendBtnDisabled: {
    backgroundColor: InkColors.bgSoft,
  },
  sendBtnIcon: {
    fontSize: 22,
    color: InkColors.ink,
    fontWeight: '900',
    lineHeight: 24,
  },
  sendBtnIconOff: { color: InkColors.ink3 },
});
