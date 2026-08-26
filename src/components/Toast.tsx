// 전역 토스트 — 화면 상단 중앙에 잠깐 떴다 사라지는 안내(성공/경고/안내).
// _layout 최상단(프레임 안)에 1회 마운트. SyncBanner(저장 실패=빨강)와 별개.
import { useEffect, useMemo } from 'react';
import { Animated, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToastStore, type ToastTone } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { frameCapStyle, CONTENT_MAX_WIDTH, SCREEN_GUTTER, Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

const TONE: Record<ToastTone, { bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  good: { bg: InkColors.ink, icon: 'checkmark-circle' },
  warn: { bg: BrandColors.warnSolid, icon: 'alert-circle' },
  info: { bg: InkColors.ink2, icon: 'information-circle' },
};

export function Toast() {
  const message = useToastStore((s) => s.message);
  const tone = useToastStore((s) => s.tone);
  const action = useToastStore((s) => s.action);
  const clear = useToastStore((s) => s.clear);
  const anim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (message) {
      Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: USE_NATIVE_DRIVER }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: USE_NATIVE_DRIVER }).start();
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
        {/* 되돌리기 — 누르면 되돌린 뒤 토스트를 닫는다. 토스트 본체(닫기)와 겹치지 않게 안쪽에서 멈춘다. */}
        {action ? (
          <Pressable
            onPress={() => { clear(); action.onPress(); }}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text style={styles.actionText}>{action.label}</Text>
          </Pressable>
        ) : null}
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
  text: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', lineHeight: 22, flexShrink: 1 },
  // 48dp 하한은 상자 크기로 지킨다(hitSlop 은 RN-web 에서 안 먹는다).
  action: { flexShrink: 0, minHeight: 48, justifyContent: 'center', paddingLeft: Space.md },
  actionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', textDecorationLine: 'underline' },
});
