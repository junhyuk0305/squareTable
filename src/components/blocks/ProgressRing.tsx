import { View, Text, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/** 링 지름·두께 — 도형 자체의 치수라 간격 토큰(Space) 대상이 아니다. */
const RING_SIZE = 64;
const RING_THICKNESS = 7;

/**
 * H3 · 진행 링 + 우측 텍스트 — "통과한 직원 5/7".
 *
 * react-native-svg를 쓰지 않는다(미설치, 새 의존성 도입 금지).
 * 대신 좌/우 반원을 각각 overflow로 잘라내고 테두리 링을 회전시켜 호를 만든다.
 * 12시부터 시계방향으로 채우고, 0~180°는 오른쪽 반원 / 180~360°는 왼쪽 반원이 담당한다.
 *
 * 회전각 유도(12시=0°, 시계방향):
 *  - top+right 테두리만 칠한 원의 호 = [-45°, 135°]. 끝을 d에 맞추려면 135+r=d → **r = d − 135**.
 *    오른쪽 클립 [0°,180°]과 교집합 → [0°, d]. (d=0 → [-180,0]이라 교집합이 비어 링이 안 찬다.)
 *  - bottom+left 테두리만 칠한 원의 호 = [135°, 315°]. 끝을 d에 맞추려면 315+r=d → **r = d − 315**.
 *    왼쪽 클립 [180°,360°]과 교집합 → [180°, d].
 *
 * 표시 전용: value/total만 받아 그린다.
 */
export function ProgressRing({
  value,
  total,
  label,
  sub,
  color = BrandColors.good,
}: {
  value: number;
  total: number;
  label: string;
  sub?: string;
  color?: string;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const deg = ratio * 360;

  return (
    <View style={styles.row}>
      <View
        style={styles.ring}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: value }}
      >
        <View style={[styles.circle, styles.track]} />

        {/* 오른쪽 반원: 0~180° */}
        <View style={[styles.half, styles.halfRight]}>
          <View
            style={[
              styles.circle,
              styles.arcRight,
              { borderTopColor: color, borderRightColor: color, marginLeft: -RING_SIZE / 2 },
              { transform: [{ rotate: `${Math.min(deg, 180) - 135}deg` }] },
            ]}
          />
        </View>

        {/* 왼쪽 반원: 180~360° (그 전에는 렌더하지 않는다) */}
        {deg > 180 ? (
          <View style={[styles.half, styles.halfLeft]}>
            <View
              style={[
                styles.circle,
                styles.arcLeft,
                { borderBottomColor: color, borderLeftColor: color },
                { transform: [{ rotate: `${deg - 315}deg` }] },
              ]}
            />
          </View>
        ) : null}

      </View>

      <View style={styles.textCol}>
        {/* ★ n/m을 링 '안'에 넣지 않는다 — 링은 고정 64px인데 글자는 배율(×1.18 + OS 배율)로 커져
            내경 50px를 넘는다("12/34"). 링은 비율만 보여주고 숫자는 여기서 자유롭게 줄바꿈한다. */}
        <Text style={styles.count}>{value}/{total}</Text>
        <Text style={styles.label}>{label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const circleBase = {
  position: 'absolute' as const,
  width: RING_SIZE,
  height: RING_SIZE,
  borderRadius: RING_SIZE / 2,
  borderWidth: RING_THICKNESS,
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  ring: { width: RING_SIZE, height: RING_SIZE },
  circle: circleBase,
  // 트랙은 ink3(2.55:1). bgSoft(#F4F5F7)는 흰 카드 위에서 1.05라 **0%일 때 링이 안 보였다**(2026-08-06).
  // 3:1(WCAG 1.4.11)까지 올리지 않은 이유: 링의 상태는 옆 텍스트(`n/m` · label · sub)가 전부 말하므로
  // 트랙은 '내용 이해에 필요한 그래픽'이 아니다. 더 어둡게 하면(#8E8E8E) 남은 구간이 채워진 것처럼 읽힌다.
  track: { borderColor: InkColors.ink3 },
  half: { position: 'absolute', top: 0, width: RING_SIZE / 2, height: RING_SIZE, overflow: 'hidden' },
  halfRight: { left: RING_SIZE / 2 },
  halfLeft: { left: 0 },
  arcRight: { borderBottomColor: 'transparent', borderLeftColor: 'transparent' },
  arcLeft: { borderTopColor: 'transparent', borderRightColor: 'transparent' },
  textCol: { flex: 1, minWidth: 0, gap: 2 },
  count: { fontSize: 26, lineHeight: 32, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  label: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: InkColors.ink2 },
});
