import { useEffect, useMemo } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { USE_NATIVE_DRIVER } from '@/lib/anim';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 아이콘 타일 — 도형 치수라 간격 토큰 대상이 아니다. */
const TILE = 56;
/** 진행바 트랙 — 실제 진행률을 알 수 없으므로 폭 고정 + 무한 반복. */
const TRACK_WIDTH = 120;
const TRACK_HEIGHT = 4;
const FILL_RATIO = 0.45;
const SWEEP_MS = 1100;

/**
 * 전환 화면 — 매장 진입처럼 화면 전체가 바뀔 때, 데이터가 다 오기 전
 * **빈 상태 UI가 스쳐 지나가는 것을 덮는다.**
 *
 * 규칙 세 줄(2026-08-07 정본 §0-1)
 *  ① 빈 상태 화면이 먼저 스치는 것은 금지 — "정말 없는 것"과 "아직 안 온 것"을 구분해서 판단한다.
 *  ② 기다리는 동안은 이 커버로 덮는다(화면 전체가 바뀔 때만).
 *  ③ 데이터가 온 뒤 크기가 바뀌면 안 된다 — 일부만 늦게 오는 곳은 미리 자리를 잡고 내용만 채운다.
 *
 * 진행바는 **실제 진행률이 아니다.** 남은 시간을 알 수 없으므로 무한 반복 스윕이고,
 * 무엇을 기다리는지는 caption 문구가 말한다(3초 넘는 로딩엔 문구를 넣는다 — 워딩 §5).
 *
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function TransitionCover({
  title,
  caption,
  icon = 'storefront-outline',
}: {
  /** 예: "성수점으로 가고 있어요" */
  title: string;
  /** 예: "노하우와 오늘 업무를 가져오는 중" */
  caption?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피.
  const sweep = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-TRACK_WIDTH * FILL_RATIO, TRACK_WIDTH],
  });

  return (
    <View style={styles.cover} accessibilityRole="progressbar" accessibilityLabel={title}>
      <View style={styles.tile}>
        <Ionicons name={icon} size={26} color={InkColors.ink} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { transform: [{ translateX }] }]} />
      </View>
      {!!caption && <Text style={styles.caption}>{caption}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.lg,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.gutter,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink, textAlign: 'center' },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: InkColors.bgSoft,
    overflow: 'hidden',
  },
  fill: {
    width: TRACK_WIDTH * FILL_RATIO,
    height: '100%',
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: InkColors.ink,
  },
  caption: { fontSize: 12, lineHeight: 17, color: InkColors.ink2, textAlign: 'center' },
});
