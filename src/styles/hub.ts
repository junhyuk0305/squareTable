import { StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { AppTypography } from '@/lib/theme/appDesign';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bgSoft },
  scroll: { padding: Space.gutter, gap: Space.lg, paddingBottom: 40 },
  titleBlock: { gap: 4 },
  title: { color: InkColors.ink, letterSpacing: -0.5, ...AppTypography.title },
  subtitle: { color: InkColors.ink2, ...AppTypography.meta },
});
