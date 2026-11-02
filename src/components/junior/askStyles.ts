import { StyleSheet, Platform } from 'react-native';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { COMPOSER_BAR_H } from '@/components/ChatComposerBar';

/** '물어보기'(JuniorAsk) 챗 UI 스타일. */
export const styles = StyleSheet.create({
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
  // 제목 아래 설명 = Type.desc(13/19 secondary · 2026-11-02 2차. 옛 14/20).
  emptySub: {
    ...Type.desc,
    marginBottom: 8,
  },
  // 근거 한 줄 — 추천 칩이 어디서 나왔는지("우리 매장 노하우 n개")를 칩 바로 위에 붙인다.
  // 출처 고지도 안내 문장이라 설명(Type.desc)으로 쓴다(2026-11-02 사용자 결정: 15 안내 문장 → 13 설명). 굵기로 고지임을 드러낸다.
  grounding: { gap: Gap.inline, marginBottom: 2 },
  groundingText: { ...Type.desc, fontWeight: '700' },
  groundingNote: Type.desc,
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
    ...Type.body,
    flex: 1,
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
  errorText: { flex: 1, fontSize: 13, color: BrandColors.accentText, fontWeight: '600' },
  retryBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: Radius.pill, backgroundColor: BrandColors.accentSolid },
  retryText: { ...Type.tag, fontWeight: '800', color: InkColors.bubbleText },
  errorClose: { fontSize: 15, fontWeight: '800', color: BrandColors.accentText },

  // 입력바(떠 있는 알약)는 공용 ChatComposerBar 가 그린다 — ＋·입력칸·보내기 = 업무 채팅(WorkChat)과
  // 같은 치수·색(2026-09-03). 알약 안에 들어가므로 입력칸은 자기 배경·테두리를 두지 않는다.
  input: {
    flex: 1,
    minHeight: 44,
    ...Type.body,
    paddingHorizontal: Space.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  plus: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  send: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep, alignItems: 'center', justifyContent: 'center' },

  // ＋ 메뉴 — WorkChat 의 menu/mi 와 같은 값. bottom 은 입력바 실높이(COMPOSER_BAR_H)를 따른다.
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menu: { position: 'absolute', left: Space.md, bottom: COMPOSER_BAR_H(44) + 4, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 6, width: 220, ...Elevation.e3 },
  mi: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: Radius.sm },
  miIc: { width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  miLabel: { ...Type.body, fontWeight: '700' },
  miSub: { ...Type.micro, color: TextColor.secondary },
});
