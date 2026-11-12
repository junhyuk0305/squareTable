import { StyleSheet, type ViewStyle } from 'react-native';

export const groupedInviteLayout = false;

// Native review overlays must not change the existing web presentation.
export const AppTypography = StyleSheet.create({
  title: {}, question: {}, group: {}, body: {}, button: {},
  status: {}, meta: {}, detail: {}, number: {},
});

export const AppStyles = StyleSheet.create({
  screen: {}, group: {}, groupRow: {}, groupHeader: {}, groupContent: {},
  titleHeader: {}, titleHeaderContent: {},
  groupUntitled: {}, groupFlushHeader: {}, groupFlush: {}, row: {}, groupSpacing: {},
  sectionSpacing: {}, actions: {}, secondaryAction: {}, notice: {}, noticeError: {},
  screenEnd: {}, screenEndSpacer: {}, screenLastItem: {},
});

export function appAlertSpacing(parentGap: number): ViewStyle {
  void parentGap;
  return {};
}

export function appScreenEndWithOverlay(height: number): ViewStyle {
  void height;
  return {};
}
