import { StyleSheet, Platform } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { COMPOSER_BAR_H } from '@/components/ChatComposerBar';

export const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 4, gap: 14 },

  similarBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
  },
  similarText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  // 이미 있는 노하우 카드 — 새로 적기 전에 한 번 멈춰 세운다(중복 노하우 차단).
  similarEntryCard: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    gap: 6,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    ...Elevation.e1,
  },
  similarEntryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  similarEntryLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  similarEntryTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  similarEntryBody: { fontSize: 15, lineHeight: 21, color: InkColors.ink2 },
  similarEntryActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  similarEntryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: Radius.sm },
  similarEntryGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  similarEntryGhostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  similarEntrySolid: { backgroundColor: InkColors.ink },
  similarEntrySolidText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },

  albaWrap: { gap: 4, alignItems: 'flex-start', maxWidth: '90%' },
  albaLabel: { fontSize: 11, fontWeight: '800', color: BrandColors.accentText, letterSpacing: 0.5 },
  albaBubble: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    borderTopLeftRadius: Radius.tail,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...Elevation.e1,
  },
  albaText: { fontSize: 15, color: InkColors.ink, fontStyle: 'italic', lineHeight: 22 },
  albaMeta: { fontSize: 11, color: InkColors.ink3, fontWeight: '500' },

  aiBubble: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderTopLeftRadius: Radius.tail,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  // 읽어서 판단해야 하는 안내문이라 본문 하한 15sp(simplicity-voice §4). 14.5 는 그 하한 위반이었다.
  aiText: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, fontWeight: '500' },

  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4 },
  loadingText: { fontSize: 13, color: InkColors.ink2, fontWeight: '600' },

  photoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  photoThumbWrap: { width: 72, height: 72, borderRadius: Radius.sm, overflow: 'hidden', position: 'relative' },
  photoThumb: { width: 72, height: 72, borderRadius: Radius.sm },
  photoUploading: { alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.paper, overflow: 'visible' },
  photoRemove: {
    position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },

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
  errorClose: { fontSize: 14, fontWeight: '800', color: BrandColors.accentText },

  // 꼬리질문 탈출구 — 입력창 바로 위, 답 안 해도 바로 등록할 수 있는 동등 액션.
  escapeBar: { alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6 },
  escapeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  escapeText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },

  // 입력바(떠 있는 알약)는 공용 ChatComposerBar 가 그린다 — 업무 채팅·직원 물어보기와 같은 형태.
  // 입력바 좌측 ＋ — 업무 채팅(WorkChat)의 composer 와 같은 형태·같은 치수.
  // 사진·음성·한번에 올리기를 아이콘 3개로 늘어놓던 옛 판본을 이 한 칸으로 접었다.
  plusBtn: { width: 38, height: 38, borderRadius: Radius.pill, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },

  // ＋ 토글 메뉴 — 입력바 위에 뜨는 팝업. 바깥을 누르면 닫힌다(menuBackdrop).
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menu: {
    // bottom 은 입력바 실높이를 따라간다 — 자리마다 다른 숫자를 베끼다 1px 겹쳐 마지막 안내 줄이
    // 잘린 이력이 있다. 내용 높이 44(입력칸·보내기 중 큰 쪽)를 공용 계산식에 넣는다.
    position: 'absolute', left: Space.md, bottom: COMPOSER_BAR_H(44) + 4, width: 232, padding: 6,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    backgroundColor: InkColors.bg, ...Elevation.e3,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: Radius.sm },
  // '한번에 올리기'만 강조 — 다른 두 항목이 한 건씩 넣는 길이라면 이건 통째로 넣는 길이다.
  menuItemAccent: { backgroundColor: BrandColors.yellowSoft },
  menuIcon: { width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  menuIconAccent: { backgroundColor: BrandColors.yellow },
  menuLabel: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  menuSub: { fontSize: 11, color: InkColors.ink3, fontWeight: '600' },
  menuInfoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 11, paddingTop: 8, paddingBottom: 2,
    borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: 4,
  },
  menuInfoText: { flex: 1, fontSize: 11, color: InkColors.ink3, fontWeight: '600' },
  // 알약(ChatComposerBar) 안에 들어가므로 자기 배경·테두리를 두지 않는다 — 두면 알약 속 알약이 된다.
  inputWrap: {
    flex: 1,
    paddingHorizontal: Space.sm,
    // 41 = 업무 채팅 입력칸과 같은 높이(MentionInput: 폰트 14 + 상하 패딩 10 + 테두리 1).
    minHeight: 41,
    maxHeight: 120,
    justifyContent: 'center',
  },
  // 포커스(선택)는 알약이 통째로 받는다 — 입력칸에 따로 테두리를 그리면 알약 안에 두 번째 상자가 생긴다.
  inputWrapFocused: {},
  // 한 줄일 때 placeholder·텍스트가 입력창(minHeight 44) 세로 중앙에 오도록 — 웹 textarea는
  // 위로 붙는 경향이 있어 상하 패딩을 대칭(10)으로 맞춘다(android는 textAlignVertical로 중앙).
  input: {
    fontSize: 15,
    color: InkColors.ink,
    paddingVertical: Platform.OS === 'android' ? 6 : 10,
    textAlignVertical: 'center',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  // ＋ 와 같은 38 — 업무 채팅(WorkChat s.plus/s.send)과 같은 치수다. 44였을 때 두 버튼 크기가
  // 서로 달라 알약 안에서 어긋나 보였다(2026-08-19 실측 후 통일).
  sendBtn: { width: 38, height: 38, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: InkColors.line },
  sendIcon: { fontSize: 22, color: InkColors.bubbleText, fontWeight: '900', lineHeight: 24 },
});
