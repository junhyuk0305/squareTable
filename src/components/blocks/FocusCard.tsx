import { View, Text, Pressable, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * H4 · 포커스 카드(블록어휘 §7-2) — **가장 급한 1건**을 인용해서 크게. [맥락 라벨] [따옴표 인용] [메타] [CTA].
 *
 * 옛 `InboxHeroCard`(0곳 사용)를 이 이름으로 되살린 것이다(2026-08-27). 그 카드는 질문(UnknownQuery)
 * 타입에 묶여 있어 다른 "급한 1건"(합류 신청 1건 대기 등)에는 못 썼다 → 문자열만 받는다.
 * 쓸 곳(§7-4 A): 노하우 허브(급한 질문이 있는 날) · 받은질문 상단 · 직원 화면(합류 대기 1건).
 * ★급한 1건이 없으면 이 카드를 비워 두지 않는다 — 호출부가 `RollupRows`(B)로 갈아탄다(빈 카드 금지).
 * ★CTA 가 화면의 Primary 다 — 같은 화면에 다른 Primary 를 두지 않는다.
 * 표시 전용: 무엇이 급한지는 호출부(sortByUrgency 등 SSOT)가 정한다.
 */
export function FocusCard({
  kicker,
  quote,
  meta,
  cta,
}: {
  /** 맥락 한 줄 — "가장 급한 것 — 직원 질문 12건 중 제일 오래됨". */
  kicker: string;
  /** 인용 본문. 따옴표는 여기서 붙인다 — 호출부가 또 붙이지 않는다. */
  quote: string;
  /** 누가·얼마나 — "박지영 · 6일째 기다리는 중". */
  meta?: string;
  cta: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker} numberOfLines={2}>{kicker}</Text>
      <Text style={styles.quote} numberOfLines={4}>“{quote}”</Text>
      {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cta.label}
        onPress={cta.onPress}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      >
        <Text style={styles.ctaText}>{cta.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: Space.gutter,
    paddingTop: Space.gutter,
    paddingBottom: Space.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e2,
  },
  // 맥락 라벨은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  kicker: { fontSize: 12, lineHeight: 17, fontWeight: '800', color: InkColors.ink3 },
  quote: { marginTop: Space.sm, fontSize: 20, lineHeight: 28, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.6 },
  meta: { marginTop: Space.sm, fontSize: 13, lineHeight: 18, color: InkColors.ink2 },
  // 사장 주 액션 — 56dp(복잡도 원칙 §4). 노랑 면 위 검정 글자(흰 글자는 노랑 위에서 안 읽힌다).
  cta: {
    marginTop: Space.lg,
    minHeight: 56,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    backgroundColor: BrandColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { fontSize: 15, lineHeight: 21, fontWeight: '900', color: InkColors.ink },
});
