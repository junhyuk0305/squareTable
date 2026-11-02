// 알림함 헤더 우상단 '전체 읽음' 액션 — 사장·직원 공용.
// 읽을 수 있는(공지·멘션) 안 읽은 알림이 있을 때만 호출부가 렌더한다(없으면 null).
// 우측 끝 여백은 헤더 표준(HEADER_EDGE_GUTTER)으로 좌측 back 화살표와 대칭.
import { Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';
import { ButtonStyles } from '@/lib/theme/button';

export function MarkAllReadButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
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
  // 누르는 높이 44(2026-11-02 사용자 결정 · 상단바 작은 알약). 글자·아이콘은 그대로 가운데 — RN-web 은 hitSlop 을 무시한다.
  //   헤더 줄은 뒤로 버튼(48)이 높이를 정하므로 44 로 키워도 헤더 높이는 그대로다.
  btn: {
    ...ButtonStyles.inlineHit,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: HEADER_EDGE_GUTTER,
  },
  text: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
