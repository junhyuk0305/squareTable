import { StyleSheet, type ViewStyle } from 'react-native';
import { BrandColors, InkColors } from './colors';
import { Radius } from './elevation';
import { Space } from './layout';

export const groupedInviteLayout = true;

// Android/iOS review rules. The web module deliberately leaves existing styles intact.
export const AppTypography = StyleSheet.create({
  title: { fontSize: 24, lineHeight: 32, fontWeight: '800' },
  question: { fontSize: 23, lineHeight: 34, fontWeight: '700' },
  group: { fontSize: 18, lineHeight: 26, fontWeight: '800' },
  body: { fontSize: 16, lineHeight: 25, fontWeight: '700' },
  button: { fontSize: 16, lineHeight: 24, fontWeight: '800' },
  status: { fontSize: 15, lineHeight: 23, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 20, fontWeight: '700' },
  detail: { fontSize: 15, lineHeight: 23, fontWeight: '400' },
  number: { fontSize: 24, lineHeight: 32, fontWeight: '800' },
});

export const AppStyles = StyleSheet.create({
  screen: { backgroundColor: InkColors.bgSoft },
  group: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 0 },
  groupFlush: { overflow: 'hidden' },
  groupRow: { backgroundColor: InkColors.bg },
  titleHeader: { paddingVertical: Space.xs },
  titleHeaderContent: { minHeight: 48 },
  groupHeader: { paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.sm, gap: Space.sm },
  groupContent: { paddingHorizontal: Space.lg, paddingBottom: Space.md },
  groupUntitled: { paddingTop: Space.md },
  groupFlushHeader: { paddingBottom: 0 },
  row: { paddingHorizontal: Space.lg, paddingVertical: Space.sm, minHeight: 52 },
  groupSpacing: { gap: Space.lg },
  sectionSpacing: { marginBottom: Space.lg },
  // Screen-end breathing room is twice the regular card gap. Fixed controls own their space.
  screenEnd: { paddingBottom: Space.lg * 2 },
  screenEndSpacer: { display: 'none' },
  screenLastItem: { marginBottom: 0 },
  actions: { gap: Space.xs, marginTop: Space.sm },
  secondaryAction: { minHeight: 48, justifyContent: 'center' },
  notice: { paddingVertical: Space.xs, paddingHorizontal: Space.md, marginVertical: Space.xs, borderRadius: Radius.md },
  noticeError: { backgroundColor: BrandColors.badSoft },
});

// Compact alerts sit 8dp from adjacent groups. Apply to the stack's direct child.
// The parent keeps its regular gap; only the alert's outside spacing is reduced.
export function appAlertSpacing(parentGap: number): ViewStyle {
  return { marginVertical: Space.sm - parentGap };
}

// Absolute action bars reserve only their measured height, then the shared end gap.
export function appScreenEndWithOverlay(height: number): ViewStyle {
  return { paddingBottom: height + Space.lg * 2 };
}
