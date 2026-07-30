// 알림함 헤더 우상단 '전체 읽음' 액션 — 사장·직원 공용.
// 읽을 수 있는(공지·멘션) 안 읽은 알림이 있을 때만 호출부가 렌더한다(없으면 null).
// 우측 끝 여백은 헤더 표준(HEADER_EDGE_GUTTER)으로 좌측 back 화살표와 대칭.
import { Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

export function MarkAllReadButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="알림 전체 읽음 처리"
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="checkmark-done" size={16} color={InkColors.ink2} />
      <Text style={styles.text}>전체 읽음</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: HEADER_EDGE_GUTTER,
    paddingVertical: 4,
  },
  text: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
