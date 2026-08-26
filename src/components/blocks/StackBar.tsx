import { View, Text, StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 막대 두께·조각 사이 간격 — 도형 치수라 간격 토큰(Space) 대상이 아니다. */
const BAR_H = 8;
const SEG_GAP = 2;

export type StackPart = {
  n: number;
  label: string;
  /** 조각 색 — 500(면) 또는 50(틴트)을 섞어 진하기로 종류를 나눈다. 글자는 얹지 않는다. */
  color: string;
};

/**
 * 가로 구성 스택바 + 캡션 — L4 지표 칸(`StatCardGrid`)의 시각요소 중 **이력이 없는** 쪽.
 *
 * 시간 축이 없는 스냅샷 지표("확인 필요 6건")에 가짜 추세를 그리지 않는다(R4). 대신
 * **지금 값을 쪼갠 구성**을 그린다 — 조각 하나하나가 실제 건수(합류 2 · 제안 1 · 노하우 3)다.
 * 조각 폭 = 건수 비율. 0건인 조각은 그리지 않고 캡션에서도 뺀다(0은 "없어요"다 — 워딩 §5).
 * 표시 전용: 건수·라벨·색은 호출부가 정한다.
 */
export function StackBar({ parts }: { parts: StackPart[] }) {
  const shown = parts.filter((p) => p.n > 0);
  if (shown.length === 0) return null;

  return (
    <View
      accessible
      accessibilityLabel={shown.map((p) => `${p.label} ${p.n}`).join(', ')}
    >
      <View style={styles.bar}>
        {shown.map((p, i) => (
          <View key={i} style={[styles.seg, { flex: p.n, backgroundColor: p.color }]} />
        ))}
      </View>
      <View style={styles.cap}>
        {shown.map((p, i) => (
          <Text key={i} style={styles.capText} numberOfLines={1}>
            <Text style={styles.capN}>{p.n}</Text> {p.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: BAR_H,
    gap: SEG_GAP,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  seg: { height: '100%', borderRadius: SEG_GAP },
  cap: { flexDirection: 'row', gap: Space.sm + Space.xs, marginTop: Space.xs, flexWrap: 'wrap' },
  // 캡션은 상태 꼬리표라 본문 15sp 하한 대상이 아니다(simplicity-voice §4 '보조').
  capText: { fontSize: 10, lineHeight: 14, color: InkColors.ink3 },
  capN: { fontWeight: '800', color: InkColors.ink2 },
});
