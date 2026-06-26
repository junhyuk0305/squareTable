import { useRef, type ReactNode } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  /** 눌렀을 때 줄어드는 비율 (기본 0.96). 카드처럼 큰 요소는 0.97, 작은 버튼은 0.93 권장. */
  scaleTo?: number;
  /** 눌렀을 때 함께 적용할 투명도 (기본 0.9) */
  dimTo?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * 누르면 살짝 줄어들었다 튕겨 돌아오는 촉각 피드백 버튼.
 * RN 내장 Animated(useNativeDriver) 기반 — 별도 설정 없이 웹·네이티브 모두 동작.
 * 기존 Pressable을 대체해 앱 전반의 '눌리는 느낌'을 통일한다.
 */
export function PressableScale({ scaleTo = 0.96, dimTo = 0.9, style, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const to = (s: number, o: number) =>
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, speed: 50, bounciness: 7 }),
      Animated.timing(opacity, { toValue: o, duration: 90, useNativeDriver: true }),
    ]).start();

  return (
    <Pressable
      onPressIn={(e) => {
        to(scaleTo, dimTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1, 1);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>{children}</Animated.View>
    </Pressable>
  );
}
