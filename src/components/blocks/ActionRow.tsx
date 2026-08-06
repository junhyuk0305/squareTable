import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 원형 아이콘 버튼 치수 — 도형 크기라 간격 토큰 대상이 아니다. 터치 타깃은 48dp 하한을 넘긴다. */
const DISC_SIZE = 52;

export type ActionRowItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** 우상단 카운트 배지. 0·미지정이면 렌더하지 않는다(예: 합류 승인 대기 인원). */
  badge?: number;
  /** 배지 카운트의 단위 — 스크린리더 낭독용(워딩 §5: 사람=명, 요청=건, 항목=개). */
  badgeUnit?: '개' | '건' | '명';
  /** 배지가 있을 때 스크린리더가 읽을 상태 설명(예: '합류 승인 대기'). */
  badgeHint?: string;
};

/**
 * A1 · 원형 아이콘 액션 행 — 3~5개. 카드 그리드(OwnerHomeHubCards)를 대체한다.
 *
 * ★ 아이콘 단독 금지 — 라벨을 반드시 병기한다(워딩 §3).
 * 표시 전용: items를 그대로 그린다.
 */
export function ActionRow({ items }: { items: ActionRowItem[] }) {
  return (
    <View style={styles.row}>
      {items.map((it) => {
        const badge = it.badge ?? 0;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            accessibilityLabel={
              badge > 0
                ? `${it.label}, ${it.badgeHint ?? '대기'} ${badge}${it.badgeUnit ?? '개'}`
                : it.label
            }
            onPress={it.onPress}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <View style={styles.disc}>
              <Ionicons name={it.icon} size={22} color={InkColors.ink} />
              {badge > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.label} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  item: { flex: 1, alignItems: 'center', gap: Space.sm, paddingVertical: Space.xs },
  pressed: { opacity: 0.7 },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: InkColors.ink2 },
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
