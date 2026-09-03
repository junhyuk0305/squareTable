import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

/**
 * ★안드로이드: 부모 opacity가 0→1로 오르는 동안 자식의 `elevation` 그림자가 알파를 안 따라가
 * 카드보다 먼저 **검은 사각 테두리**로 그려진다(2026-09-03 실기기). 기본 렌더가 요소마다 알파를
 * 따로 곱하기 때문 — 재생 중에만 오프스크린 합성을 켜서 서브트리 통째로 알파를 먹인다.
 * 상시 켜면 목록 카드마다 오프스크린 버퍼가 생기므로 끝나면 끈다.
 *
 * ★오프스크린 레이어는 **뷰 상자 크기로 잘린다** — 상자 밖에 그려지는 elevation 그림자가 레이어에 못 들어가
 * 재생 중엔 그림자가 없다가 끄는 순간 툭 나타났다(2차·3차 실기기). 그래서 재생 중엔 상자를 그림자만큼
 * 바깥으로 넓힌다: `margin: -BLEED, padding: +BLEED` — 레이아웃(마진 상자)은 그대로, 레이어만 커져
 * 그림자가 카드와 **같은 레이어에서 함께** 페이드된다. 끝나면 원래 상자로 돌아온다(알파 1이라 그림 동일).
 * 넓힌 영역은 `pointerEvents="box-none"`이라 옆 요소의 터치를 가로채지 않는다.
 *
 * 넓히기는 style이 상자 자체를 정하지 않을 때만 한다(아래 BOX_PROPS) — padding·테두리·배경·폭이 있는 style에
 * 마진/패딩을 겹치면 레이아웃이 깨진다. 그런 자리는 넓히지 않고 진행 55%(투명도 ≈0.91)에 레이어를 먼저 끈다 —
 * 그림자가 늦게 붙긴 하지만 카드가 거의 불투명한 시점이라 덜 튄다.
 */
const NEEDS_OFFSCREEN_ALPHA = Platform.OS === 'android';
/** 그림자 여유(dp). Elevation e3(12)까지 덮는다 — 안드로이드 elevation 그림자는 ~2×elevation 안에 든다. */
const BLEED = 32;
const SHADOW_RELEASE_AT = 0.55;
/** 이 속성이 style에 있으면 상자를 넓히지 않는다 — 넓히는 마진/패딩과 충돌하거나(padding·margin·width),
 *  넓힌 영역까지 칠해지거나(배경·테두리), 위치 계산이 달라진다(position·overflow). */
const BOX_PROPS: readonly (keyof ViewStyle)[] = [
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingHorizontal', 'paddingVertical', 'paddingStart', 'paddingEnd',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'aspectRatio',
  'position', 'top', 'bottom', 'left', 'right',
  'backgroundColor', 'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'borderRadius',
  'overflow',
];
const canBleed = (style: StyleProp<ViewStyle>) => {
  const flat = StyleSheet.flatten(style) as Record<string, unknown> | undefined;
  if (!flat) return true;
  return BOX_PROPS.every((k) => flat[k] === undefined);
};

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
  const [offscreen, setOffscreen] = useState(NEEDS_OFFSCREEN_ALPHA);
  // 상자 넓히기 여부는 마운트 시점 style로 한 번만 정한다 — 재생 중 바뀌면 레이아웃이 튄다.
  const bleed = useMemo(() => NEEDS_OFFSCREEN_ALPHA && canBleed(style), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    let release: ReturnType<typeof setTimeout> | undefined;
    if (bleed) {
      // 그림자가 레이어 안에 있으므로 끝까지 함께 페이드 → 끝난 뒤 끈다(알파 1이라 화면 변화 없음).
      anim.start(({ finished }) => {
        if (finished) setOffscreen(false);
      });
    } else {
      anim.start();
      if (NEEDS_OFFSCREEN_ALPHA) release = setTimeout(() => setOffscreen(false), delay + duration * SHADOW_RELEASE_AT);
    }
    return () => {
      anim.stop();
      if (release) clearTimeout(release);
    };
  }, [v, delay, duration, bleed]);

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [offsetY, 0] });

  return (
    <Animated.View
      needsOffscreenAlphaCompositing={offscreen}
      style={[style, bleed && offscreen && bleedStyle, { opacity: v, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.View>
  );
}

const bleedStyle: ViewStyle = { margin: -BLEED, padding: BLEED, pointerEvents: 'box-none' };
