import { useEffect, useMemo, type ReactNode } from 'react';
import { Animated, Easing, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { USE_NATIVE_DRIVER } from '@/lib/anim';

import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 채팅 입력바 — **떠 있는 알약**. 업무 채팅·노하우 코치·직원 물어보기가 이걸 같이 쓴다.
 *
 * 왜 한 곳으로 모으나: 같은 자리를 세 화면이 각자 그리고 있었다(띠 배경 3종·패딩 3종·
 * 입력칸 라운드 2종). 한 화면만 고치면 나머지 둘이 조용히 달라진다 — 이번에 실제로 그랬다.
 *
 * · 화면 배경(paper) 위에 흰 알약이 떠 있는 그림이다. 가로로 꽉 찬 띠 + 윗줄(borderTop)로
 *   화면을 잘라 놓던 옛 형태를 대체한다. 대화방 상단의 떠 있는 헤더와 같은 형태·같은 그림자다.
 * · **붙박이(flow)로 둔다.** 절대배치하면 스트림 바닥이 입력창에 가려지고, 키보드가 올라올 때
 *   KeyboardAvoidingView 가 밀어 줄 대상이 사라진다.
 * · 알약이 곧 입력칸의 테두리다 → 안에 넣는 TextInput 은 자기 배경·테두리를 지운다.
 *   안 지우면 알약 속 알약이 되어 테두리가 두 겹으로 보인다.
 *
 * 알약 위에 뜨는 ＋ 메뉴의 `bottom` 은 이 바의 실높이를 따라간다 —
 * `COMPOSER_BAR_H(내용높이)` 로 계산한다(자리마다 다른 상수를 쓰다 1px 겹쳐 잘린 이력이 있다).
 */
export const COMPOSER_BAR_H = (contentH: number) => Space.sm + 6 + contentH + 6 + Space.md;

export function ChatComposerBar({
  children,
  align = 'center',
  style,
}: {
  children: ReactNode;
  /** 여러 줄로 자라는 입력칸을 쓰는 화면(코치)은 'flex-end' — ＋·보내기가 바닥에 붙는다. */
  align?: 'center' | 'flex-end';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={s.outer}>
      <View style={[s.bar, { alignItems: align }, style]}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: { paddingHorizontal: Space.md, paddingTop: Space.sm, paddingBottom: Space.md },
  bar: {
    flexDirection: 'row',
    gap: Space.xs,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bg,
    ...Elevation.e2,
  },
});

/**
 * ＋ ↔ ✕ 토글 아이콘 — **아이콘을 갈아 끼우지 않고 45° 돌린다.** 더하기를 45° 돌리면 그게 곧 ✕라,
 * 두 상태 사이에 실제로 이어지는 동작이 있다(갈아 끼우면 그 자리에서 툭 바뀐다).
 *
 * 새 애니메이션 프리미티브가 아니다 — `Appear`·`Collapse` 옆에 세우지 않는다.
 * 이건 '＋ 버튼 하나'의 내부 동작이고 쓰는 자리도 채팅 입력바 둘뿐이라, 이 파일(입력바 키트) 안에 둔다.
 * 감속 곡선은 앱에 하나뿐인 그것(`.32,.72,0,1`)을 쓴다.
 */
export function PlusToggleIcon({ open, size = 24, color }: { open: boolean; size?: number; color: string }) {
  // ★초기값에 `open` 을 넣지 않는다. `useMemo` 는 보장이 아니라 힌트라 **React Compiler 가
  //   다시 계산할 수 있고**, 그러면 토글할 때마다 목표값으로 태어난 새 Value 가 생겨 회전이
  //   그 자리에서 툭 끝난다(1.5초로 늘려 재 봐도 한 프레임 만에 0°→45°였다 — 2026-08-19 실측).
  //   Appear 와 똑같이 **입력 없는 0** 으로 만들고, 목표는 아래 효과에서만 준다.
  const v = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    anim.start();
    return () => anim.stop();
  }, [open, v]);

  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="add" size={size} color={color} />
    </Animated.View>
  );
}
