import { StyleSheet } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export const loginCompactActions = false;
export const loginActivityColor = '#FFF';

export const loginStyles = StyleSheet.create({
  actions: {},
  safe: { flex: 1, backgroundColor: InkColors.cream },
  topbar: { height: 48, justifyContent: 'center' },
  scroll: { flexGrow: 1, padding: Space.xl, paddingTop: Space.xs, justifyContent: 'center', gap: 28 },
  header: { alignItems: 'center', gap: Space.md },
  tagline: { fontSize: 13, lineHeight: 19, color: InkColors.ink3, textAlign: 'center' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.gutter,
    gap: Space.sm,
  },
  seg: { flexDirection: 'row', backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.xs, marginBottom: 6 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segText: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: InkColors.ink3 },
  segTextOn: { color: InkColors.ink },

  label: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: InkColors.ink2, marginTop: Space.xs },
  input: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  primary: {
    marginTop: Space.md,
    backgroundColor: BrandColors.brand,
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '800' },
  msg: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, textAlign: 'center', marginTop: 2 },
  msgErr: { color: BrandColors.accentText, fontWeight: '700' },
  demoNote: { fontSize: 12, lineHeight: 18, color: InkColors.ink3, textAlign: 'center' },
  forgotRow: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.sm },
  forgotText: { fontSize: 13, fontWeight: '600', color: InkColors.ink2, textDecorationLine: 'underline' },
  googleHint: { fontSize: 12, lineHeight: 18, color: InkColors.ink3, textAlign: 'center' },
  signupBlock: { alignItems: 'center', gap: Space.md },
  signupLead: { fontSize: 13, lineHeight: 19, color: InkColors.ink3 },
  signupBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingVertical: 15,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  signupBtnText: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
});
