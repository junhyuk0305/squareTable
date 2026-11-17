import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InkColors, Surface } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Layout, Space } from '@/lib/theme/layout';

/**
 * 단계 화면의 맨 아래 고정 노란 버튼 하나(화면조립표 2026-11-17 11절 3번).
 * 이름 = 다음 단계 이름. "다음"·"확인"·"완료"를 쓰지 않는다. 스크롤 밖, 화면 맨 아래에 둔다.
 * 아래 여백 = 안전 영역. 공간 첫 5분 도크와 같은 꼴이다.
 */
export function StepDock({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const off = disabled || busy;
  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, Space.md) }]}>
      <Pressable
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!off, busy: !!busy }}
        style={({ pressed }) => [styles.primary, off && styles.off, pressed && styles.pressed]}
      >
        {busy ? <ActivityIndicator color={InkColors.ink} /> : <Text style={ButtonTextStyles.primaryOnYellow}>{label}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: Layout.screenX,
    paddingTop: Space.sm,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: Surface.card,
  },
  primary: ButtonStyles.primaryYellow,
  off: { opacity: 0.45 },
  pressed: { opacity: 0.88 },
});
