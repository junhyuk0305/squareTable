import { useEffect, useMemo } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';


import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 진행 막대 두께 — 도형 치수라 간격 토큰 대상이 아니다. */
const BAR_HEIGHT = 4;
/** 차오르는 시간 — 애니메이션 규칙의 150~250ms 안(ui.md). */
const FILL_MS = 240;

/**
 * C형(몰입형) 화면의 진행 표시 — `n / m` + 막대 + 이번 단계 제목.
 *
 * 단계 UI를 새로 만들지 않는다. 이미 순차 전환하는 시트(모달 위 모달 금지) 위에
 * "지금 몇 번째인지"만 얹는 표시 전용 블록이다.
 * 근거: Opus `Question 1 of 15` · Connecteam `2/4`.
 */
export function StepProgress({
  step,
  total,
  title,
}: {
  /** 1부터 시작하는 현재 단계 */
  step: number;
  total: number;
  title: string;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, step / total)) : 0;

  /**
   * 막대는 **차오른다** — 단계가 넘어갈 때 폭이 순간이동하면 진행이 아니라 화면이 튄 것으로 보인다.
   *
   * ★새 애니메이션 프리미티브가 아니다. Appear(등장)·Collapse(펼침)로는 표현할 수 없는
   *   **이 블록 고유의 값 변화**라 여기 안에만 둔다(TransitionCover 의 스윕과 같은 성격).
   *   다른 자리에서 진행 막대를 다시 만들지 말 것 — 이 블록을 쓴다.
   * ★width 는 레이아웃 값이라 네이티브 드라이버로 못 돌린다 → `useNativeDriver: false` 고정
   *   (Collapse 의 height 와 같은 이유). 감속 곡선은 앱에 하나뿐인 그것을 쓴다.
   */
  const v = useMemo(() => new Animated.Value(ratio), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: ratio,
      duration: FILL_MS,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [v, ratio]);
  const width = v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: step }}
    >
      <View style={styles.head}>
        <Text style={styles.count}>{step} / {total}</Text>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  count: { fontSize: 13, fontWeight: '900', color: InkColors.ink2 },
  title: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  track: { height: BAR_HEIGHT, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  // 채워진 만큼은 브랜드 노랑이다(2026-08-26). 검정 막대는 회색 트랙과 명도만 다를 뿐이라
  // "여기까지 왔다"가 눈에 안 들어왔다. 색은 브랜드 2색 안에서만 쓴다(디자인 시스템).
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
});
