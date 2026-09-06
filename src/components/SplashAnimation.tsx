import { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

/**
 * 진입 스플래시 모션 (디자인시스템.md 5장).
 * 매장의(1)→정석(2)→노란 밑줄 좌→우→카피 페이드업 → 로그인으로 페이드.
 * 이 구간(~1.9s)에 세션 체크/로딩 시간을 숨긴다. 라이트(크림) 배경.
 * RN core Animated + native driver. 밑줄은 transformOrigin:left 로 좌→우 scaleX.
 *
 * ★모션이 끝나도 `ready` 가 아니면 **걷지 않는다.** 예전엔 고정 타이머라 세션이 1.9초를 넘기면
 *   스플래시가 먼저 사라지고 그 아래 빈 화면이 드러났다. 커버가 걷히는 시점 = 화면이 다 준비된 시점이다.
 */
export function SplashAnimation({ ready = true, onDone }: { ready?: boolean; onDone: () => void }) {
  // 렌더 중 ref.current 접근을 피하려 lazy useState 로 안정 값 생성.
  const [c1] = useState(() => new Animated.Value(0));
  const [c2] = useState(() => new Animated.Value(0));
  const [under] = useState(() => new Animated.Value(0));
  const [copy] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));
  // 로고 모션이 끝났는가. 걷는 조건은 이것 **그리고** ready 둘 다다.
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const reveal = (v: Animated.Value, delay: number) =>
      Animated.timing(v, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE_DRIVER });

    const intro = Animated.parallel([
      reveal(c1, 140),
      reveal(c2, 380),
      Animated.timing(under, { toValue: 1, duration: 420, delay: 700, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE_DRIVER }),
      reveal(copy, 1040),
    ]);
    intro.start(({ finished }) => {
      if (finished) setIntroDone(true);
    });
    return () => intro.stop();
  }, [c1, c2, under, copy]);

  // 페이드아웃 = 화면을 넘기는 순간. 모션이 끝났고 **데이터도 도착했을 때만** 시작한다.
  useEffect(() => {
    if (!introDone || !ready) return;
    const out = Animated.timing(fade, { toValue: 0, duration: 340, delay: 360, useNativeDriver: USE_NATIVE_DRIVER });
    out.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => out.stop();
  }, [introDone, ready, fade, onDone]);

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
          {/* ★띄어쓰기를 글자와 같은 Text 에 넣지 않는다 — 공백은 한글 폴백 폰트가 아니라 시스템 폰트로
              그려져서, 그 Text 의 줄 상자(ascent/descent)만 커진다. 두 Text 의 기준선이 어긋나
              '정석'이 살짝 올라가 보였다(2026-09-06 iOS 실기기). 간격은 마진으로 준다. */}
          <Animated.Text style={[styles.char, styles.charGap, charStyle(c1)]} allowFontScaling={false}>
            매장의
          </Animated.Text>
          <Animated.Text style={[styles.char, charStyle(c2)]} allowFontScaling={false}>
            정석
          </Animated.Text>
        </View>
        <Animated.Text
          style={[
            styles.copy,
            { opacity: copy, transform: [{ translateY: copy.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
          ]}
        >
          우리 매장 운영의 기준
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
  markRow: { position: 'relative', flexDirection: 'row', alignItems: 'baseline' },
  underline: {
    position: 'absolute',
    left: -5,
    right: -5,
    bottom: 4,
    height: 15,
    borderRadius: 5,
    backgroundColor: BrandColors.yellow,
    zIndex: 0,
    transformOrigin: 'left center', // 좌→우로 채워지게 (RN 0.76+ 지원)
  },
  char: {
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -2,
    color: InkColors.ink,
    zIndex: 1,
  },
  // 지웠던 공백(38px 기준 ≈9px)에서 letterSpacing(-2)을 뺀 만큼.
  charGap: { marginRight: 7 },
  copy: {
    fontSize: 15,
    fontWeight: '600',
    color: InkColors.ink2,
    letterSpacing: -0.3,
  },
});
