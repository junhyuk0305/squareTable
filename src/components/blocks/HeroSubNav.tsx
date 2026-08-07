import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 서브내비 칸 수 — 4칸 고정. 5칸이면 460px에서 라벨이 두 줄로 깨진다(정본 배치규칙 ④). */
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

/**
 * N2 · 히어로 직결 서브내비 — 검은 색면 히어로 + 바닥에 이어 붙은 4칸 바로가기.
 *
 * 왜 카드가 아니라 색면인가: 카드 모서리에 서브내비를 붙이면 라운드에 잘려 지저분해진다.
 * 왜 붙여야 하는가: 떨어뜨리면 A1 원형 액션 로우와 중복돼 블록을 하나 더 먹는다.
 * (2026-08-05 블록 어휘 v3 · 출처앱 오늘얼마)
 *
 * `items`를 비우면 서브내비 없이 히어로만 전체 라운드로 그린다(직원 홈 용법).
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
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
  /** 4칸 고정. 초과분은 그리지 않는다. */
  items?: HeroSubNavItem[];
}) {
  const nav = items.slice(0, SUBNAV_MAX);
  const hasNav = nav.length > 0;

  return (
    <View>
      <View style={[styles.hero, hasNav ? styles.heroWithNav : styles.heroAlone]}>
        <Text style={styles.label}>{label}</Text>
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
                      <Text style={styles.badgeText}>{it.badge > 9 ? '9+' : it.badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cellLabel} numberOfLines={1}>{it.label}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: InkColors.ink,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.gutter,
  },
  heroWithNav: { borderTopLeftRadius: Radius.md, borderTopRightRadius: Radius.md },
  heroAlone: { borderRadius: Radius.md },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: InkColors.bubbleText,
    opacity: 0.65,
  },
  value: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -1,
    color: InkColors.bubbleText,
    marginTop: Space.xs,
    marginBottom: Space.sm,
  },
  caption: {
    fontSize: 13.5,
    lineHeight: 20,
    color: InkColors.bubbleText,
    opacity: 0.82,
  },
  cta: {
    marginTop: Space.md,
    paddingVertical: Space.md,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  ctaText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  pressed: { opacity: 0.75 },
  subnav: {
    flexDirection: 'row',
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: InkColors.line,
    borderBottomLeftRadius: Radius.md,
    borderBottomRightRadius: Radius.md,
    overflow: 'hidden',
  },
  cell: { flex: 1 },
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
  cellLabel: { fontSize: 11, fontWeight: '700', color: InkColors.ink2 },
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
