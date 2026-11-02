import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Animated } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';

/**
 * 매장의 정석 토글 스위치 — 디자인 스펙: on = 검정 track + 노란 knob, off = 회색 track + 흰 knob.
 * RN <Switch> 는 웹에서 trackColor 가 안 먹어(틸색 기본값) 커스텀으로 통일.
 */
const W = 50;
const H = 30;
const PAD = 3;
const KNOB = H - PAD * 2;
// ★누르는 영역 48(2026-11-02 사용자 결정). RN-web 은 hitSlop 을 무시하므로 **상자 크기**로 지킨다
//   (ScreenTitleHeader back 과 같은 방식). 모양(50×30)은 그대로 두고, 늘어난 위아래 9씩은 음수 margin 으로
//   되돌려 주변 행 높이가 밀리지 않게 한다. 호출부 행(SettingsKit·RoomDrawer)은 위아래 여백이 13~15라 상자가 행 안에 든다.
const TOUCH = 48;
const TOUCH_OUT = (TOUCH - H) / 2;

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
      style={styles.hit}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.knob, { backgroundColor: knobColor, transform: [{ translateX: knobX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { minWidth: TOUCH, minHeight: TOUCH, marginVertical: -TOUCH_OUT, justifyContent: 'center' },
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
