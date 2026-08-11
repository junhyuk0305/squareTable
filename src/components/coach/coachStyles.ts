import { StyleSheet, Platform } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

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

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  attachBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  // ⓘ 배지 앵커 — 사진 아이콘 우하단에 겹쳐 붙는다(입력바 한 칸을 따로 차지하지 않게).
  attachWrap: { position: 'relative' },
  attachInfo: { position: 'absolute', right: -3, bottom: 3 },
  inputWrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    backgroundColor: InkColors.bg,
    minHeight: 44,
    maxHeight: 120,
    justifyContent: 'center',
  },
  // 포커스(선택) 상태 — 브라우저 기본 아웃라인 대신 잉크 테두리로 일관 강조(직원 물어보기와 동일 규칙).
  inputWrapFocused: { borderColor: InkColors.ink },
  // 한 줄일 때 placeholder·텍스트가 입력창(minHeight 44) 세로 중앙에 오도록 — 웹 textarea는
  // 위로 붙는 경향이 있어 상하 패딩을 대칭(10)으로 맞춘다(android는 textAlignVertical로 중앙).
  input: {
    fontSize: 15,
    color: InkColors.ink,
    paddingVertical: Platform.OS === 'android' ? 6 : 10,
    textAlignVertical: 'center',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: InkColors.line },
  sendIcon: { fontSize: 22, color: InkColors.bubbleText, fontWeight: '900', lineHeight: 24 },
});
