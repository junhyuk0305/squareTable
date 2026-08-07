import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';

/**
 * 공통 펼침 애니메이션 — 마운트 시 높이 0 → 실측 높이로 열린다(fade 동반).
 * 아코디언·펼침 패널이 순간이동하듯 튀어나오는 것을 막는다. 아래 내용이 밀려나는 것까지 같이 움직인다.
 *
 * 쓰는 법: 기존 `{open && <내용/>}` 의 내용부만 감싼다 — 조건식은 그대로 둔다.
 *   {open && <Collapse style={{ gap: 8 }}>...</Collapse>}
 * `style` 은 안쪽(내용) View 로 간다 — 바깥은 높이를 재는 클리핑 박스라 gap/padding 을 여기 두면 안 된다.
 *
 * ⚠️ height 는 네이티브 드라이버로 못 돌린다(레이아웃 값) → `useNativeDriver: false` 고정.
 *    웹(RNW)도 같은 JS 드라이버 경로라 그대로 동작한다. (TodoScreen 달력 접힘과 같은 메커니즘)
 * ⚠️ Animated.Value 는 ref 가 아니라 useMemo 안정 객체로 — render 중 ref.current 접근(react-hooks/refs) 회피.
 * ※ 접힘은 조건식이 즉시 언마운트하므로 애니메이션이 없다(펼침만 움직인다).
 */
const OPEN_MS = 200;
/** 측정을 이만큼 기다려도 안 오면 애니메이션을 포기하고 그냥 보여준다. */
const MEASURE_TIMEOUT_MS = 300;

export function Collapse({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useMemo(() => new Animated.Value(0), []);
  // onLayout 으로 잰 내용 높이. 재기 전(0)에는 height 0 + opacity 0 으로 숨겨 첫 프레임 깜빡임을 막는다.
  const [h, setH] = useState(0);
  // ★fail-open: onLayout 이 끝내 안 불리면 패널이 영영 안 보인다 — 이 프로젝트에서 세 번 재발한
  //   '죽은 컨트롤' 유형이다. 못 재면 애니메이션을 버리고 자연 높이로 그린다.
  //   잃는 것은 부드러움 하나뿐이고, 잃지 않는 것은 화면 그 자체다.
  const [unmeasured, setUnmeasured] = useState(false);

  useEffect(() => {
    if (h > 0) return;
    const t = setTimeout(() => setUnmeasured(true), MEASURE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [h]);

  useEffect(() => {
    if (h <= 0) return;
    // 이미 자연 높이로 보여주고 있었다면(측정이 늦게 온 경우) 애니메이션을 다시 돌리지 않는다.
    // 0에서 시작하면 열려 있던 패널이 접혔다가 다시 열려 더 나쁘다.
    if (unmeasured) {
      v.setValue(1);
      return;
    }
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [v, h, unmeasured]);

  const height = v.interpolate({ inputRange: [0, 1], outputRange: [0, h] });

  return (
    <Animated.View
      style={[styles.box, h > 0 ? { height, opacity: v } : unmeasured ? null : styles.measuring]}
    >
      <View style={style} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  measuring: { height: 0, opacity: 0 },
});
