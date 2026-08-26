import { View, Text, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/** 링 지름·두께 — 도형 자체의 치수라 간격 토큰(Space) 대상이 아니다. */
const RING_SIZE = 64;
const RING_THICKNESS = 7;
/** 히어로 자리(퀴즈 홈)의 지름·두께. 두께는 지름에 맞춰 키운다 — 안 그러면 실처럼 가늘어진다. */
const HERO_RING_SIZE = 168;
const HERO_RING_THICKNESS = 16;

/**
 * H3 · 진행 링 — "통과한 직원 5/7".
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
 * 배치는 두 가지다(호를 그리는 계산이 같아 한 블록으로 둔다 — ui.md "재구현 금지"):
 *  · 기본  = 작은 링(64px) 좌측 + `n/m`·글자 우측. **숫자를 링 안에 넣지 않는다** — 내경이 50px
 *           뿐이라 배율(×1.18 + OS 배율)에서 "12/34"가 넘쳤다(2026-08-06 실측).
 *  · hero = 큰 링(168px)을 가운데 세우고 `n/m` 을 **링 안**에, 문장은 아래에 둔다.
 *           내경이 136px 라 위 제약이 걸리지 않는다(화면당 1개 · 배치규칙②).
 *
 * 표시 전용: value/total만 받아 그린다.
 */
export function ProgressRing({
  value,
  total,
  label,
  sub,
  color = BrandColors.good,
  hero = false,
}: {
  value: number;
  total: number;
  label: string;
  sub?: string;
  color?: string;
  /** 화면의 주인공 자리인가 — 큰 링 + 가운데 정렬. */
  hero?: boolean;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const deg = ratio * 360;
  const size = hero ? HERO_RING_SIZE : RING_SIZE;
  const thickness = hero ? HERO_RING_THICKNESS : RING_THICKNESS;
  const circle = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: thickness,
  };

  return (
    <View style={hero ? styles.stack : styles.row}>
      <View
        style={{ width: size, height: size }}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: value }}
      >
        <View style={[circle, styles.track]} />

        {/* 오른쪽 반원: 0~180° */}
        <View style={[styles.half, { width: size / 2, height: size, left: size / 2 }]}>
          <View
            style={[
              circle,
              styles.arcRight,
              { borderTopColor: color, borderRightColor: color, marginLeft: -size / 2 },
              { transform: [{ rotate: `${Math.min(deg, 180) - 135}deg` }] },
            ]}
          />
        </View>

        {/* 왼쪽 반원: 180~360° (그 전에는 렌더하지 않는다) */}
        {deg > 180 ? (
          <View style={[styles.half, { width: size / 2, height: size, left: 0 }]}>
            <View
              style={[
                circle,
                styles.arcLeft,
                { borderBottomColor: color, borderLeftColor: color },
                { transform: [{ rotate: `${deg - 315}deg` }] },
              ]}
            />
          </View>
        ) : null}

        {/* 히어로만 `n/m` 이 링 **안**에 들어간다 — 내경이 136px 라 배율을 올려도 들어간다.
            (기본 크기 64px 는 내경이 50px 뿐이라 "12/34" 가 안 들어갔다 — 2026-08-06 실측.)
            ★상자를 자르지 않는다(overflow 없음) — OS 200% 같은 극단에서는 글자가 링 위로 번지되
              **잘리지는 않는다**. 자르면 숫자를 못 읽는다. */}
        {hero ? (
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={styles.countHero}>{value}/{total}</Text>
          </View>
        ) : null}
      </View>

      <View style={hero ? styles.textStack : styles.textCol}>
        {hero ? null : <Text style={styles.count}>{value}/{total}</Text>}
        <Text style={[styles.label, hero && styles.centerText]}>{label}</Text>
        {sub ? <Text style={[styles.sub, hero && styles.centerText]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  stack: { alignItems: 'center', gap: Space.lg },
  // 트랙은 ink3(2.55:1). bgSoft(#F4F5F7)는 흰 카드 위에서 1.05라 **0%일 때 링이 안 보였다**(2026-08-06).
  // 3:1(WCAG 1.4.11)까지 올리지 않은 이유: 링의 상태는 옆 텍스트(`n/m` · label · sub)가 전부 말하므로
  // 트랙은 '내용 이해에 필요한 그래픽'이 아니다. 더 어둡게 하면(#8E8E8E) 남은 구간이 채워진 것처럼 읽힌다.
  track: { borderColor: InkColors.ink3 },
  half: { position: 'absolute', top: 0, overflow: 'hidden' },
  arcRight: { borderBottomColor: 'transparent', borderLeftColor: 'transparent' },
  arcLeft: { borderTopColor: 'transparent', borderRightColor: 'transparent' },
  textCol: { flex: 1, minWidth: 0, gap: 2 },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  textStack: { alignSelf: 'stretch', alignItems: 'center', gap: Space.xs },
  centerText: { textAlign: 'center' },
  count: { fontSize: 26, lineHeight: 32, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  countHero: { fontSize: 34, lineHeight: 42, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  label: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: InkColors.ink2 },
});
