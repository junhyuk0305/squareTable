import { View, Text, Pressable, StyleSheet } from 'react-native';
import { getCategoryMeta } from '@/lib/utils/category';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { Radius } from '@/lib/theme/elevation';

type Props = {
  category: string; // 기본 4종 키 또는 매장 커스텀 카테고리 id
  size?: 'sm' | 'md' | 'lg';
  count?: number;
  selected?: boolean;
  onPress?: () => void;
  showLabel?: boolean;
};

export function CategoryChip({ category, size = 'md', count, selected, onPress, showLabel = true }: Props) {
  const customs = usePlaybookStore((s) => s.customCategories); // 커스텀 라벨 변경에 즉시 반응
  const meta = getCategoryMeta(category, customs);
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
      {/* 이모티콘 대신 색깔 점 — 카테고리는 (색점 + 이름)으로만 표시(그림 이모지 금지). */}
      <View
        style={{
          width: sz.dot,
          height: sz.dot,
          borderRadius: Radius.pill,
          backgroundColor: selected ? '#FFFFFF' : meta.color,
        }}
      />
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
  sm: { padV: 3, padH: 8,  dot: 6, label: 11, count: 10 },
  md: { padV: 6, padH: 12, dot: 7, label: 13, count: 11 },
  lg: { padV: 12, padH: 20, dot: 9, label: 18, count: 14 },
} as const;

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '700' },
  count: {
    minWidth: 18,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  countText: { fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
