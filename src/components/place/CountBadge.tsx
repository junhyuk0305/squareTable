import { View, Text, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/**
 * 묶음 제목 옆 건수 배지(공간 홈 · 교육 탭 · 설정 탭 · 2026-11-17). 건수는 여기 한 번만 적는다.
 * 모양 = 탭바·ActionRow 배지와 같은 규격(accentSolid 면 · 흰 숫자). 99 를 넘으면 99+.
 * label = 읽기 이름(배지 숫자만으로는 무엇을 세는지 모른다).
 */
export function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <View style={styles.badge} accessibilityLabel={`${label} ${count}`}>
      <Text style={styles.text}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18, minHeight: 18, paddingHorizontal: Space.xs, borderRadius: Radius.pill,
    backgroundColor: BrandColors.accentSolid, alignItems: 'center', justifyContent: 'center',
  },
  text: { ...Type.micro, fontWeight: '900', color: InkColors.bubbleText },
});
