import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';

/** 업무 탭(채팅·공지·할일·리액션) 공용 스타일. WorkBoard와 각 슬롯 컴포넌트가 공유한다. */
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  chatScroll: { padding: 16, gap: 12 },
  noticeScroll: { padding: 16, gap: 12 },
  todoScroll: { padding: 16, gap: 14 },

  streamEmpty: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', paddingVertical: 20 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: InkColors.line },
  dividerText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { fontSize: 13, color: InkColors.ink3, fontWeight: '500' },

  // 메시지 말풍선
  msgRow: { gap: 3, alignItems: 'flex-start' },
  msgAuthor: { fontSize: 11, color: InkColors.ink3, fontWeight: '600', marginLeft: 2 },
  msgBubbleWrap: { maxWidth: '82%', gap: 3 },
  msgBubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  msgBubbleMine: { backgroundColor: BrandColors.brand, borderColor: BrandColors.brand },
  msgText: { fontSize: 15, color: InkColors.ink, lineHeight: 20 },
  msgTime: { fontSize: 10, color: InkColors.ink3, marginHorizontal: 2 },
  toTaskBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', paddingVertical: 2 },
  toTaskText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },

  // 입력바 (채팅·공지 공용)
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: InkColors.bgSoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: BrandColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 공지 카드
  notice: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBD3CD',
    padding: 14,
    gap: 8,
  },
  noticePinned: { borderColor: BrandColors.accent, borderWidth: 1.5 },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noticeAuthor: { fontSize: 12, fontWeight: '800', color: BrandColors.accent },
  noticeTime: { fontSize: 11, color: InkColors.ink3, marginLeft: 'auto' },
  noticeText: { fontSize: 15, color: InkColors.ink, lineHeight: 21 },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },

  // 할일 관리(사장)
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  uploadingText: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  manageWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
    gap: 12,
  },
  manageTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  editorGroup: { gap: 4 },
  editorLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  editorText: { flex: 1, fontSize: 14, color: InkColors.ink },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  addInput: { flex: 1, fontSize: 14, color: InkColors.ink, paddingVertical: 2 },
  addBtn: { fontSize: 14, fontWeight: '800', color: BrandColors.brand },

  // 리액션
  reactWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  reactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reactChipMine: { borderColor: BrandColors.brand, backgroundColor: '#FFFFFF' },
  reactEmoji: { fontSize: 14 },
  reactCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  reactWho: { fontSize: 11, color: InkColors.ink3 },
  reactAdd: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: InkColors.bgSoft,
  },
  reactPick: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
  },
});
