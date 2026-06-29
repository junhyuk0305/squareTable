import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CategoryChip } from '@/components/CategoryChip';
import { InkColors } from '@/lib/theme/colors';
import { formatAsked } from '@/lib/utils/time';
import type { UnknownQuery } from '@/types';

type Props = {
  uq: UnknownQuery;
  onPress: () => void;
};

/**
 * 인박스 한 줄 — pending(hero 제외) UQ. 카드 없이 border-bottom 1px line.
 */
export function InboxRowItem({ uq, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.chipCol}>
        <CategoryChip category={uq.presumed_category} size="sm" showLabel={false} />
      </View>
      <View style={styles.bodyCol}>
        <Text style={styles.query} numberOfLines={2}>
          {uq.query_text}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {uq.anonymous ? '🔒 익명' : uq.junior_name} · {formatAsked(uq.asked_at, '방금')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  rowPressed: { backgroundColor: InkColors.bgSoft },
  chipCol: { flexShrink: 0 },
  bodyCol: { flex: 1, minWidth: 0 },
  query: {
    fontSize: 16,
    color: InkColors.ink,
    fontWeight: '500',
    lineHeight: 22,
  },
  meta: {
    fontSize: 12,
    color: InkColors.ink3,
    fontWeight: '600',
    marginLeft: 6,
    flexShrink: 0,
  },
});
