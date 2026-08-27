import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 디스크 치수 — 도형 크기라 간격 토큰 대상이 아니다. 터치 타깃은 칸(item) 전체라 48dp 를 넘긴다. */
const DISC_CARD = 38;
const DISC_TILE = 30;
const ITEM_MIN_H = 48;

export type ActionRowItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** 라벨 아래 상태 한 줄("58개" · "4건 진행 중"). **있을 때만** — 0이면 라벨만(§7-4). */
  hint?: string;
  /** 주 액션 — 디스크(card)·타일(tile)이 노랑. **한 행에 1개만**(둘 이상 금지). */
  primary?: boolean;
  /** 우상단 카운트 배지. 0·미지정이면 렌더하지 않는다(예: 합류 승인 대기 인원). */
  badge?: number;
  /** 배지 카운트의 단위 — 스크린리더 낭독용(워딩 §5: 사람=명, 요청=건, 항목=개). */
  badgeUnit?: '개' | '건' | '명';
  /** 배지가 있을 때 스크린리더가 읽을 상태 설명(예: '합류 승인 대기'). */
  badgeHint?: string;
};

/**
 * A1′/A2′ · 액션 행 3개(블록어휘 §7-2 · 2026-08-27).
 *
 * 옛 AR1(맨바닥 원 3개, 상자 없음)은 **폐기** — 화면의 다른 블록은 전부 상자 안인데 이것만 밖에 있어
 * 소속 없이 떠 보였다(데모 §2-6). 두 형태만 남긴다:
 *  · `card`(AR2+, 기본) = 한 카드 3분할 + 세로 구분선. 칸 = [디스크 38] [라벨] [상태 한 줄].
 *    액션이 **같은 층의 형제**일 때(노하우 허브 하단: 추가·목록·퀴즈).
 *  · `tile`(AR4+) = 타일 3개. [좌상 디스크 30 + 우상 ›] [라벨] [상태 한 줄]. 주 액션 타일 = yellowSoft.
 *    액션이 **서로 다른 곳**으로 갈 때(현황 하단: 답하기·직원·급여). 우상단 › 가 "지표 카드가 아니라
 *    눌리는 곳"임을 형태로 말한다.
 * 규칙: 주 액션 1개만 노랑 · 라벨 6자 이내·줄바꿈 금지 · 상태 한 줄은 있을 때만.
 *
 * ★ 아이콘 단독 금지 — 라벨을 반드시 병기한다(워딩 §3).
 * 표시 전용: items를 그대로 그린다.
 */
export function ActionRow({ items, variant = 'card' }: { items: ActionRowItem[]; variant?: 'card' | 'tile' }) {
  const tile = variant === 'tile';
  return (
    <View style={tile ? styles.tileRow : styles.cardRow}>
      {items.map((it, i) => {
        const badge = it.badge ?? 0;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            accessibilityLabel={
              badge > 0
                ? `${it.label}, ${it.badgeHint ?? '대기'} ${badge}${it.badgeUnit ?? '개'}`
                : it.hint ? `${it.label}, ${it.hint}` : it.label
            }
            onPress={it.onPress}
            style={({ pressed }) => [
              tile ? styles.tileItem : styles.cardItem,
              tile && it.primary && styles.tileItemPrimary,
              !tile && i > 0 && styles.cardDivider,
              pressed && styles.pressed,
            ]}
          >
            <View style={tile ? styles.tileTop : undefined}>
              <View style={[tile ? styles.discTile : styles.discCard, it.primary && styles.discPrimary]}>
                <Ionicons name={it.icon} size={tile ? 15 : 17} color={InkColors.ink} />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                ) : null}
              </View>
              {tile ? <Ionicons name="chevron-forward" size={13} color={InkColors.ink3} style={styles.tileChevron} /> : null}
            </View>
            <Text style={tile ? styles.tileLabel : styles.cardLabel} numberOfLines={1}>{it.label}</Text>
            {it.hint ? <Text style={styles.hint} numberOfLines={1}>{it.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── card(AR2+) ──
  cardRow: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  cardItem: { flex: 1, minWidth: 0, minHeight: ITEM_MIN_H, alignItems: 'center', paddingVertical: Space.md, paddingHorizontal: Space.xs },
  cardDivider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  discCard: {
    width: DISC_CARD,
    height: DISC_CARD,
    borderRadius: DISC_CARD / 2,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discPrimary: { backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep },
  // 라벨·상태 한 줄은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  cardLabel: { marginTop: Space.xs + 2, fontSize: 12, lineHeight: 17, fontWeight: '800', color: InkColors.ink },
  hint: { fontSize: 10.5, lineHeight: 15, color: InkColors.ink3 },
  pressed: { opacity: 0.7 },

  // ── tile(AR4+) ──
  tileRow: { flexDirection: 'row', gap: Space.sm },
  tileItem: {
    flex: 1,
    minWidth: 0,
    minHeight: ITEM_MIN_H,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  tileItemPrimary: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellowDeep },
  tileTop: { flexDirection: 'row', alignItems: 'center' },
  discTile: {
    width: DISC_TILE,
    height: DISC_TILE,
    borderRadius: Radius.sm,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileChevron: { marginLeft: 'auto' },
  tileLabel: { marginTop: Space.sm, fontSize: 12.5, lineHeight: 17, fontWeight: '800', color: InkColors.ink },

  // 벨·허브 카드와 같은 규격(액센트 원형). 흰 숫자 11sp를 얹으므로 면은 500이 아니라 Solid(800).
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    // ★height 고정 금지 → minHeight. 배율(×1.18 + OS 배율)이 오르면 11sp 숫자가 18px 상자를 넘겨
    //   세로로 잘린다(복잡도 원칙 §4 · 이 프로젝트 재발 이력).
    minHeight: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '900', color: InkColors.bubbleText },
});
