import { View, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';

/** 막대 영역 높이·막대 사이 간격·최소 막대 높이 — 도형 치수라 간격 토큰(Space) 대상이 아니다. */
const BAR_AREA_H = 26;
const BAR_GAP = 3;
const BAR_MIN_H = 2;
const BAR_RADIUS = 2;

export type SparkTone = 'muted' | 'on' | 'warn';

const COLOR: Record<SparkTone, string> = {
  muted: InkColors.line,
  on: InkColors.ink,
  warn: BrandColors.warn,
};

/**
 * 세로 막대 스파크라인 — L4 지표 칸(`StatCardGrid`)의 시각요소 중 **이력이 있는** 쪽.
 *
 * ★R4(블록어휘 §7-1): 막대 하나하나가 실제 원장 값이어야 한다 — "주 1개 = 그 주 질문 수",
 *   "막대 1개 = 직원 1명(통과/미통과)". 이력 원장이 없는 스냅샷 지표는 이걸 쓰지 말고
 *   `StackBar`(지금 값의 구성)를 쓴다. 장식용 형태는 금지다.
 * react-native-svg 를 쓰지 않는다(미설치, 새 의존성 도입 금지) — View 로만 그린다.
 *
 * 값은 최대값 기준 비율로 높이를 정한다. `tones` 는 막대별 색 역할(기본 line 회색 ·
 * on=검정 · warn=주황), `hotLast` 는 "마지막 막대만 on"의 줄임이다.
 * 표시 전용: 값·색 역할은 호출부가 정한다.
 */
export function Sparkline({
  values,
  tones,
  hotLast = false,
  accessibilityLabel,
}: {
  values: number[];
  /** 막대별 색 역할. 길이가 values 보다 짧으면 나머지는 muted/hotLast 규칙을 따른다. */
  tones?: SparkTone[];
  /** 마지막 막대만 강조(이번 주). tones 가 그 자리를 지정하면 tones 가 우선한다. */
  hotLast?: boolean;
  /** 스크린리더용 한 문장(예: "최근 5주 질문 수, 이번 주 12건"). 없으면 장식으로 취급된다. */
  accessibilityLabel?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);

  return (
    <View
      style={styles.row}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      // ★importantForAccessibility 는 **안드로이드 전용**이다 — iOS 에서 짝은 이것 하나뿐이라,
      //   빠뜨리면 라벨 없는 장식 그래프의 막대 하나하나가 VoiceOver 에 그대로 읽힌다(2026-09-07 전수 점검).
      accessibilityElementsHidden={!accessibilityLabel}
    >
      {values.map((v, i) => {
        const tone: SparkTone = tones?.[i] ?? (hotLast && i === values.length - 1 ? 'on' : 'muted');
        const h = Math.max(BAR_MIN_H, Math.round((Math.max(0, v) / max) * BAR_AREA_H));
        return <View key={i} style={[styles.bar, { height: h, backgroundColor: COLOR[tone] }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: BAR_GAP, height: BAR_AREA_H },
  bar: { flex: 1, borderRadius: BAR_RADIUS },
});
