import { StyleSheet } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { AppStyles, AppTypography } from '@/lib/theme/appDesign';

export const loginCompactActions = true;
export const loginActivityColor = InkColors.ink;

export const loginStyles = StyleSheet.create({
  safe: { flex: 1, ...AppStyles.screen },
  topbar: { height: 48, justifyContent: 'center' },
  scroll: { flexGrow: 1, padding: Space.gutter, paddingVertical: Space.xl, justifyContent: 'center', gap: Space.xl },
  header: { alignItems: 'center', gap: Space.sm },
  tagline: { ...AppTypography.meta, color: InkColors.ink2, textAlign: 'center' },
  card: { ...AppStyles.group, padding: Space.lg },
  seg: { flexDirection: 'row', backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.xs, marginBottom: Space.sm },
  segBtn: { flex: 1, minHeight: 48, paddingVertical: Space.sm, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: InkColors.bg },
  segText: { ...AppTypography.body, color: InkColors.ink2 },
  segTextOn: { color: InkColors.ink },
  label: { ...AppTypography.body, color: InkColors.ink, marginTop: Space.md },
  input: {
    minHeight: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    marginTop: Space.xs,
    ...AppTypography.body,
    color: InkColors.ink,
    backgroundColor: InkColors.bgSoft,
  },
  primary: {
    marginTop: Space.lg,
    minHeight: 52,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    backgroundColor: BrandColors.yellow,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...AppTypography.button, color: InkColors.ink },
  msg: { ...AppTypography.status, ...AppStyles.notice, color: InkColors.ink2 },
  msgErr: { ...AppStyles.noticeError, color: BrandColors.accentText },
  demoNote: { ...AppTypography.meta, color: InkColors.ink2, textAlign: 'center' },
  actions: { ...AppStyles.actions },
  forgotRow: { ...AppStyles.secondaryAction, alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: Space.sm },
  forgotText: { ...AppTypography.body, color: InkColors.ink },
  googleHint: { ...AppTypography.meta, color: InkColors.ink2, textAlign: 'center' },
  signupBlock: { alignItems: 'center', gap: Space.xs },
  signupLead: { ...AppTypography.meta, color: InkColors.ink2 },
  signupBtn: { ...AppStyles.secondaryAction, alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: Space.sm },
  signupBtnText: { ...AppTypography.body, color: InkColors.ink },
});
