import { useEffect, useMemo, type ReactNode } from 'react';
import { Animated, Easing, type ViewStyle, type StyleProp } from 'react-native';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

/**
 * 목록 등장 스태거 지연(ms) — `<Appear delay={stagger(i)}>`.
 * 줄당 30ms, **8번째(i=7)에서 상한**. 상한이 없으면 100줄짜리 목록의 마지막 줄이 3초 뒤에 떠서 버그로 보인다.
 * 상한값을 여기 한 곳에만 둔다(자리마다 다른 숫자를 쓰는 것이 드리프트의 원인).
 */
const STAGGER_MS = 30;
const STAGGER_CAP = 7;
export const stagger = (i: number) => Math.min(i, STAGGER_CAP) * STAGGER_MS;

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
