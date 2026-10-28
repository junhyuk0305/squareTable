import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Gap, Space } from '@/lib/theme/layout';
import { ButtonStyles } from '@/lib/theme/button';
import { SectionGroup } from '@/components/SectionGroup';

/** 서브내비 칸 수 — **상한 4칸**. 5칸이면 460px에서 라벨이 두 줄로 깨진다(정본 배치규칙 ④).
 *  칸은 flex:1 이라 3칸도 정상이다(2026-08-19 사장 홈이 '급여' 칸을 빼고 3칸이 됐다). */
const SUBNAV_MAX = 4;
/** 칸 구분선의 위아래 여백 — 전체 높이 선이 아니라 가운데만 긋는다. */
const DIVIDER_INSET = Space.md;
/** 배지 도형 — 아이콘 우상단에 걸친다. 도형 치수라 간격 토큰 대상이 아니다. */
const BADGE_SIZE = 14;
const BADGE_LEFT = 10;

export type HeroSubNavItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** 놓치면 안 되는 대기 건수(예: 합류 승인). 0·undefined면 그리지 않는다. */
  badge?: number;
  /** 배지가 무엇인지 — 화면 낭독용. 색만으로 뜻을 알 수 없으니 반드시 같이 준다. */
  badgeHint?: string;
};

/** Home summary with a shared white surface, brand action and related shortcuts. */
export function HeroSubNav({
  label,
  value,
  caption,
  ctaLabel,
  onCta,
  items = [],
}: {
  /** 히어로 상단 작은 라벨 — 예: "답을 기다리는 질문" */
  label: string;
  /** 큰 수 — 예: "5건" */
  value: string;
  /** 인용문·부제. 줄바꿈 허용. */
  caption?: string;
  /** 노란 CTA 문구. onCta와 함께 있을 때만 그린다. */
  ctaLabel?: string;
  onCta?: () => void;
  /** 최대 4칸. 초과분은 그리지 않는다. */
  items?: HeroSubNavItem[];
}) {
  const nav = items.slice(0, SUBNAV_MAX);
  const hasNav = nav.length > 0;

  return (
    <SectionGroup title={label} flush>
      <View style={styles.hero}>
        <Text style={styles.value}>{value}</Text>
        {!!caption && <Text style={styles.caption}>{caption}</Text>}
        {!!ctaLabel && !!onCta && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            onPress={onCta}
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </Pressable>
        )}
      </View>

      {hasNav && (
        <View style={styles.subnav}>
          {nav.map((it, i) => (
            <View key={it.key} style={styles.cell}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  it.badge ? `${it.label} · ${it.badgeHint ?? '대기'} ${it.badge}` : it.label
                }
                onPress={it.onPress}
                style={({ pressed }) => [styles.cellTap, pressed && styles.pressed]}
              >
                <View>
                  <Ionicons name={it.icon} size={18} color={InkColors.ink} />
                  {!!it.badge && it.badge > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText} maxFontSizeMultiplier={1.3}>{it.badge > 9 ? '9+' : it.badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cellLabel}>{it.label}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </SectionGroup>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: Gap.item,
    paddingBottom: Space.lg,
    paddingHorizontal: Space.lg,
  },
  value: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -1,
    color: InkColors.ink,
    marginBottom: Space.sm,
  },
  caption: {
    // 사장 홈에서 이 자리는 직원 질문 원문이다 — 읽어서 판단하는 문장이라 본문 15sp 하한 대상.
    // (정본 HTML의 12~13.5px은 웹 목업 값이다.)
    fontSize: 16,
    lineHeight: 24,
    color: InkColors.ink2,
  },
  cta: {
    ...ButtonStyles.brand,
    marginTop: Space.md,
  },
  ctaText: { ...ButtonStyles.brandText },
  pressed: { opacity: 0.75 },
  subnav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  cell: { flexGrow: 1, flexShrink: 1, flexBasis: 88, minWidth: 0 },
  divider: {
    position: 'absolute',
    left: 0,
    top: DIVIDER_INSET,
    bottom: DIVIDER_INSET,
    width: 1,
    backgroundColor: InkColors.line,
  },
  cellTap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    paddingVertical: Space.md,
    paddingHorizontal: Space.xs,
    minHeight: 48,
  },
  cellLabel: { fontSize: 14, lineHeight: 21, fontWeight: '700', color: InkColors.ink2, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    left: BADGE_LEFT,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    paddingHorizontal: 3,
    borderRadius: BADGE_SIZE / 2,
    // 흰 글자를 얹는 면이라 500(bad)이 아니라 Solid.
    backgroundColor: BrandColors.badSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9, fontWeight: '900', color: InkColors.bubbleText },
});
