// 전역 저장 실패 배너 — 화면 상단에 떠서, 서버 반영 실패를 사용자가 알게 한다.
// _layout 최상단(프레임 안)에 1회 마운트. 평소엔 아무것도 그리지 않는다.
// 3초 뒤 서서히 흐려지며 자동으로 사라진다(X 즉시 닫기도 유지).
import { useEffect, useMemo } from 'react';
import { Animated, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { CONTENT_MAX_WIDTH, SCREEN_GUTTER, Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

const AUTO_DISMISS_MS = 3000;

export function SyncBanner() {
  const error = useSyncStore((s) => s.error);
  const seq = useSyncStore((s) => s.seq);
  const clear = useSyncStore((s) => s.clear);
  const opacity = useMemo(() => new Animated.Value(1), []); // RoleTabBar와 동일 패턴(렌더 중 ref 접근 금지)

  // 새 오류(seq 증가)마다 완전 불투명으로 리셋 → 3초 뒤 페이드아웃 후 제거.
  useEffect(() => {
    if (!error) return;
    opacity.setValue(1);
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: USE_NATIVE_DRIVER }).start(() => clear());
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [error, seq, opacity, clear]);

  if (!error) return null;
  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="box-none">
      <Animated.View style={styles.banner}>
        <Ionicons name="cloud-offline-outline" size={17} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={2}>
          {error}
        </Text>
        <Pressable onPress={clear} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <Ionicons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
    </Animated.View>
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
    backgroundColor: BrandColors.accentSolid,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    shadowColor: InkColors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '700', lineHeight: 22 },
});
