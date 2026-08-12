import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';

/**
 * 공통 사라짐 애니메이션 — `hidden` 이 켜지면 fade + 높이 0 으로 접힌 뒤 `onDone` 을 부른다.
 * 목록에서 항목이 빠질 때 순간이동하듯 사라지는 것을 막는다(아래 항목이 밀려 올라오는 것까지 같이 움직인다).
 *
 * `Appear`(등장)·`Collapse`(펼침)의 짝이다 — 이 셋 밖에서 사라짐을 자리마다 다시 만들지 않는다.
 *
 * 쓰는 법: **지우는 동작을 onDone 으로 미룬다.** 데이터를 먼저 바꾸면 항목이 즉시 언마운트돼 애니메이션이 없다.
 *   <Vanish hidden={leaving === e.id} onDone={() => verify(e)} style={styles.row}>...</Vanish>
 * `style` 은 안쪽(내용) View 로 간다 — 바깥은 높이를 재는 클리핑 박스다(Collapse 와 같은 규약).
 *
 * ⚠️ height 는 네이티브 드라이버로 못 돌린다(레이아웃 값) → `useNativeDriver: false` 고정.
 * ★fail-open: 애니메이션이 중간에 끊겨도(언마운트·hidden 해제) `onDone` 은 반드시 한 번 실행된다 —
 *   안 그러면 사장이 누른 동작이 조용히 사라진다(이 프로젝트에서 세 번 재발한 '죽은 컨트롤' 유형).
 */
const VANISH_MS = 180;

export function Vanish({
  hidden,
  onDone,
  children,
  style,
}: {
  hidden: boolean;
  onDone?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  // Animated.Value 는 ref 가 아니라 useMemo 안정 객체로 — render 중 ref.current 접근(react-hooks/refs) 회피.
  const v = useMemo(() => new Animated.Value(1), []);
  // 보이는 동안 계속 재는 내용 높이. 접을 때 여기서 0 으로 간다.
  const [h, setH] = useState(0);

  // onDone 은 대개 인라인 화살표라 매 렌더 새 함수다 — deps 에 넣으면 애니메이션이 다시 시작된다.
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (!hidden) return;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      doneRef.current?.();
    };
    const anim = Animated.timing(v, {
      toValue: 0,
      duration: VANISH_MS,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) fire();
    });
    // 언마운트·hidden 해제로 끊겨도 동작은 실행한다(위 fail-open).
    return () => {
      anim.stop();
      fire();
    };
  }, [hidden, v]);

  const height = v.interpolate({ inputRange: [0, 1], outputRange: [0, h] });

  return (
    <Animated.View style={[{ opacity: v }, hidden && h > 0 ? [styles.box, { height }] : null]}>
      <View style={style} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
