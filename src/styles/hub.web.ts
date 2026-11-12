import { StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bgSoft },
  scroll: { padding: Space.gutter, gap: Space.lg, paddingBottom: 40 },
  titleBlock: { gap: 4 },
  title: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: InkColors.ink2 },
});
