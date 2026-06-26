import { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';

/**
 * 진입 스플래시 모션 (착착 디자인시스템.md 5장).
 * 착(1)→착(2)→노란 밑줄 좌→우→카피 페이드업 → 로그인으로 페이드.
 * 이 구간(~1.9s)에 세션 체크/로딩 시간을 숨긴다. 라이트(크림) 배경.
 * RN core Animated + native driver. 밑줄은 transformOrigin:left 로 좌→우 scaleX.
 */
export function SplashAnimation({ onDone }: { onDone: () => void }) {
  // 렌더 중 ref.current 접근을 피하려 lazy useState 로 안정 값 생성.
  const [c1] = useState(() => new Animated.Value(0));
  const [c2] = useState(() => new Animated.Value(0));
  const [under] = useState(() => new Animated.Value(0));
  const [copy] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const reveal = (v: Animated.Value, delay: number) =>
      Animated.timing(v, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });

    Animated.parallel([
      reveal(c1, 140),
      reveal(c2, 380),
      Animated.timing(under, { toValue: 1, duration: 420, delay: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      reveal(copy, 1040),
    ]).start(() => {
      Animated.timing(fade, { toValue: 0, duration: 340, delay: 360, useNativeDriver: true }).start(() => onDone());
    });
  }, [c1, c2, under, copy, fade, onDone]);

  const charStyle = (v: Animated.Value) => ({
    opacity: v,
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) },
    ],
  });

  return (
    <Animated.View style={[styles.fill, { opacity: fade }]}>
      <View style={styles.center}>
        <View style={styles.markRow}>
          <Animated.View
            style={[
              styles.underline,
              { transform: [{ scaleX: under }] },
            ]}
          />
          <Animated.Text style={[styles.char, charStyle(c1)]} allowFontScaling={false}>
            착
          </Animated.Text>
          <Animated.Text style={[styles.char, charStyle(c2)]} allowFontScaling={false}>
            착
          </Animated.Text>
        </View>
        <Animated.Text
          style={[
            styles.copy,
            { opacity: copy, transform: [{ translateY: copy.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
          ]}
        >
          할 일이 착착 끝나는 가게
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: InkColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  center: { alignItems: 'center', gap: 18 },
  markRow: { position: 'relative', flexDirection: 'row' },
  underline: {
    position: 'absolute',
    left: -6,
    right: -6,
    bottom: 6,
    height: 22,
    borderRadius: 7,
    backgroundColor: BrandColors.yellow,
    zIndex: 0,
    transformOrigin: 'left center', // 좌→우로 채워지게 (RN 0.76+ 지원)
  },
  char: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -3,
    color: InkColors.ink,
    zIndex: 1,
  },
  copy: {
    fontSize: 15,
    fontWeight: '600',
    color: InkColors.ink2,
    letterSpacing: -0.3,
  },
});
