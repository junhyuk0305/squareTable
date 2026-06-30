import { useEffect, useMemo, type ReactNode } from 'react';
import { Animated, Easing, type ViewStyle, type StyleProp } from 'react-native';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

/**
 * 공통 등장 애니메이션 — 마운트 시 fade-in + 살짝 위로 슬라이드.
 * 채팅 말풍선·카드·리스트 항목 등 "새로 나타나는" 요소에 감싸 쓴다.
 * key를 안정적으로 주면 항목당 1회만 재생된다(리렌더에도 반복 안 함).
 * useNativeDriver로 opacity/transform만 — RN-web에서도 안전.
 */
export function Appear({
  children,
  delay = 0,
  offsetY = 10,
  duration = 280,
  style,
}: {
  children: ReactNode;
  delay?: number;
  offsetY?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피.
  const v = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    anim.start();
    return () => anim.stop();
  }, [v, delay, duration]);

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [offsetY, 0] });

  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
