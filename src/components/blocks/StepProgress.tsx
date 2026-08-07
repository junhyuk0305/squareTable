import { View, Text, StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 진행 막대 두께 — 도형 치수라 간격 토큰 대상이 아니다. */
const BAR_HEIGHT = 4;

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
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
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
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: InkColors.ink },
});
