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

  albaWrap: { gap: 4, alignItems: 'flex-start', maxWidth: '90%' },
  albaLabel: { fontSize: 11, fontWeight: '800', color: BrandColors.accent, letterSpacing: 0.5 },
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
  aiText: { fontSize: 14.5, color: InkColors.ink2, lineHeight: 21, fontWeight: '500' },

  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4 },
  loadingText: { fontSize: 13, color: InkColors.ink2, fontWeight: '600' },

  photoTag: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', paddingHorizontal: 4 },

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
  errorClose: { fontSize: 14, fontWeight: '800', color: BrandColors.accent },

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
  attachBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  attachIcon: { fontSize: 20 },
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
  input: { fontSize: 15, color: InkColors.ink, paddingVertical: Platform.OS === 'ios' ? 10 : 6 },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: InkColors.line },
  sendIcon: { fontSize: 22, color: InkColors.bubbleText, fontWeight: '900', lineHeight: 24 },

  reviewFootHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  reviewFootText: { fontSize: 14, fontWeight: '800' },
  reviewFootSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
});
