import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Animated } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';

/**
 * 착착 토글 스위치 — 디자인 스펙: on = 검정 track + 노란 knob, off = 회색 track + 흰 knob.
 * RN <Switch> 는 웹에서 trackColor 가 안 먹어(틸색 기본값) 커스텀으로 통일.
 */
const W = 50;
const H = 30;
const PAD = 3;
const KNOB = H - PAD * 2;

export function ChachakSwitch({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
}) {
  const [anim] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 170, useNativeDriver: false }).start();
  }, [value, anim]);

  const trackColor = anim.interpolate({ inputRange: [0, 1], outputRange: [InkColors.line, InkColors.ink] });
  const knobColor = anim.interpolate({ inputRange: [0, 1], outputRange: ['#FFFFFF', BrandColors.yellow] });
  const knobX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, W - KNOB - PAD * 2] });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.knob, { backgroundColor: knobColor, transform: [{ translateX: knobX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: W,
    height: H,
    borderRadius: H / 2,
    padding: PAD,
    justifyContent: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
