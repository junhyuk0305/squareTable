// 전역 토스트 — 화면 상단 중앙에 잠깐 떴다 사라지는 안내(성공/경고/안내).
// _layout 최상단(프레임 안)에 1회 마운트. SyncBanner(저장 실패=빨강)와 별개.
import { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToastStore, type ToastTone } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { frameCapStyle, CONTENT_MAX_WIDTH, SCREEN_GUTTER, Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';

const TONE: Record<ToastTone, { bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  good: { bg: InkColors.ink, icon: 'checkmark-circle' },
  warn: { bg: BrandColors.warn, icon: 'alert-circle' },
  info: { bg: InkColors.ink2, icon: 'information-circle' },
};

export function Toast() {
  const message = useToastStore((s) => s.message);
  const tone = useToastStore((s) => s.tone);
  const clear = useToastStore((s) => s.clear);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message) {
      Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }
  }, [message, anim]);

  if (!message) return null;
  const t = TONE[tone] ?? TONE.good;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        frameCapStyle,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] },
      ]}
    >
      <Pressable onPress={clear} style={[styles.toast, { backgroundColor: t.bg }]}>
        <Ionicons name={t.icon} size={17} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </Pressable>
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
    zIndex: 1100,
    paddingHorizontal: SCREEN_GUTTER,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: CONTENT_MAX_WIDTH,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    shadowColor: InkColors.ink,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  text: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700', lineHeight: 18, flexShrink: 1 },
});
