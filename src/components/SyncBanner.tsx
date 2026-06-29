// 전역 저장 실패 배너 — 화면 상단에 떠서, 서버 반영 실패를 사용자가 알게 한다.
// _layout 최상단(프레임 안)에 1회 마운트. 평소엔 아무것도 그리지 않는다.
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { CONTENT_MAX_WIDTH, SCREEN_GUTTER, Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';

export function SyncBanner() {
  const error = useSyncStore((s) => s.error);
  const clear = useSyncStore((s) => s.clear);
  if (!error) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner}>
        <Ionicons name="cloud-offline-outline" size={17} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={2}>
          {error}
        </Text>
        <Pressable onPress={clear} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <Ionicons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 8 : 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    paddingHorizontal: SCREEN_GUTTER,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: CONTENT_MAX_WIDTH,
    width: '100%',
    backgroundColor: BrandColors.accent,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    shadowColor: InkColors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
