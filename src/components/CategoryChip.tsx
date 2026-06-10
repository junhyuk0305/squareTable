import { View, Text, Pressable, StyleSheet } from 'react-native';
import { getCategoryMeta } from '@/lib/utils/category';
import type { Category } from '@/types';

type Props = {
  category: Category;
  size?: 'sm' | 'md' | 'lg';
  count?: number;
  selected?: boolean;
  onPress?: () => void;
  showLabel?: boolean;
};

export function CategoryChip({ category, size = 'md', count, selected, onPress, showLabel = true }: Props) {
  const meta = getCategoryMeta(category);
  const sz = SIZES[size];

  const content = (
    <View
      style={[
        styles.chip,
        {
          paddingVertical: sz.padV,
          paddingHorizontal: sz.padH,
          backgroundColor: selected ? meta.color : meta.soft,
          borderColor: meta.color,
          borderWidth: selected ? 0 : 1,
        },
      ]}
    >
      <Text style={{ fontSize: sz.emoji }}>{meta.emoji}</Text>
      {showLabel && (
        <Text
          style={[
            styles.label,
            {
              fontSize: sz.label,
              color: selected ? '#FFFFFF' : meta.color,
            },
          ]}
        >
          {meta.label}
        </Text>
      )}
      {typeof count === 'number' && (
        <View style={[styles.count, { backgroundColor: selected ? 'rgba(255,255,255,0.25)' : meta.color }]}>
          <Text style={[styles.countText, { color: '#FFFFFF', fontSize: sz.count }]}>
            {count}
          </Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return content;
}

const SIZES = {
  sm: { padV: 3, padH: 8,  emoji: 11, label: 11, count: 10 },
  md: { padV: 6, padH: 12, emoji: 14, label: 13, count: 11 },
  lg: { padV: 12, padH: 20, emoji: 22, label: 18, count: 14 },
} as const;

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '700' },
  count: {
    minWidth: 18,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  countText: { fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
