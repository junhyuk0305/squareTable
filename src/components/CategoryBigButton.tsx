import { View, Text, Pressable, StyleSheet } from 'react-native';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors } from '@/lib/theme/colors';
import type { Category } from '@/types';

type Props = {
  category: Category;
  count: number;
  onPress: () => void;
};

/**
 * 사장님 빅뱅 입력 — 카테고리 큰 버튼 (2x2 그리드 셀).
 * - 정사각에 가까운 흰 배경 카드
 * - border-left 4px: 카테고리 컬러
 * - 좌상단 큰 이모지 / 중앙 카테고리 한국어 라벨 / 짧은 설명
 * - 우하단: 누적 카운트 chip (게임화 효과)
 */
export function CategoryBigButton({ category, count, onPress }: Props) {
  const meta = getCategoryMeta(category);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} 카테고리, 누적 ${count}건`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderLeftColor: meta.color },
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.emoji}>{meta.emoji}</Text>

      <View style={styles.middle}>
        <Text style={[styles.label, { color: meta.color }]} numberOfLines={1}>
          {meta.label}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>
          {meta.description}
        </Text>
      </View>

      <View style={[styles.countChip, { backgroundColor: meta.color }]}>
        <Text style={styles.countText}>{count}건</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 180,
    backgroundColor: InkColors.bg,
    borderRadius: 14,
    borderLeftWidth: 4,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 14,
    justifyContent: 'space-between',
    // shadow (iOS)
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    // shadow (Android)
    elevation: 2,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  emoji: {
    fontSize: 40,
    lineHeight: 46,
  },
  middle: {
    marginTop: 8,
    gap: 4,
  },
  label: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  desc: {
    fontSize: 14,
    lineHeight: 18,
    color: InkColors.ink3,
    fontWeight: '500',
  },
  countChip: {
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
