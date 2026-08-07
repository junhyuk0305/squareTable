import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 블록 X2 — 인라인 경고행. 터치 타깃(48dp 하한)보다 한 단계 큰 행 높이. */
const ROW_MIN_HEIGHT = 52;
const ICON_SIZE = 22;

/**
 * X2 · 인라인 경고행 — "확인이 필요한 노하우 3건 ›"
 *
 * 색은 레드로 확정(2026-08-05). 흰 배경 + 점 방식은 묻혀서 기각했고,
 * 좌측 세로 바는 둥근 모서리에서 잘려 폐기했다. 배경을 badSoft로 채운다.
 *
 * ★ count가 0이면 아무것도 렌더하지 않는다 — 상시 노출 금지.
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function AlertRow({
  label,
  count,
  unit = '개',
  onPress,
  icon = 'alert-circle',
}: {
  label: string;
  count: number;
  /** 개수 단위 — 물건·항목은 '개', 요청·질문·신청은 '건', 사람은 '명'(워딩 §5). */
  unit?: '개' | '건' | '명';
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  if (count <= 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${count}${unit}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.dot}>
        <Ionicons name={icon} size={14} color={InkColors.bubbleText} />
      </View>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <View style={styles.pill}>
        <Text style={styles.pillText}>{count}{unit}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={BrandColors.badText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.badSoft,
  },
  pressed: { opacity: 0.75 },
  dot: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: BrandColors.bad,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: BrandColors.badText,
  },
  pill: {
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bubbleText,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '800',
    color: BrandColors.badText,
  },
});
