import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 디스크 치수 — 도형 크기라 간격 토큰 대상이 아니다. 터치 타깃은 칸(item) 전체라 48dp 를 넘긴다. */
const DISC = 38;
const ITEM_MIN_H = 48;

export type ActionRowItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** 라벨 아래 상태 한 줄("58개" · "4건 진행 중"). **있을 때만** — 0이면 라벨만(§7-4). */
  hint?: string;
  /** 주 액션 — 디스크가 노랑. **한 행에 1개만**(둘 이상 금지). */
  primary?: boolean;
  /** 우상단 카운트 배지. 0·미지정이면 렌더하지 않는다(예: 합류 승인 대기 인원). */
  badge?: number;
  /** 배지 카운트의 단위 — 스크린리더 낭독용(워딩 §5: 사람=명, 요청=건, 항목=개). */
  badgeUnit?: '개' | '건' | '명';
  /** 배지가 있을 때 스크린리더가 읽을 상태 설명(예: '합류 승인 대기'). */
  badgeHint?: string;
};

/**
 * A1′ · 액션 행(블록어휘 §7-2 · 2026-08-27).
 *
 * 한 카드 n분할 + 세로 구분선. 칸 = [디스크 38] [라벨] [상태 한 줄].
 * ★2026-11-02: 형태를 하나로 통일했다. 예전 `tile`(사각 30 · 왼쪽 정렬 · 칸마다 카드)은 같은 "아이콘 + 라벨"
 *   바로가기가 화면마다 다른 모양으로 보여 폐기했다(사용자 결정).
 * ★상태 한 줄은 칸마다 있을 때만 그리지만, 한 칸이라도 있으면 나머지 칸도 그 줄 높이를 비워 둔다 —
 *   안 그러면 상태 없는 칸만 아래가 비어 행이 어긋나 보인다(직원 출퇴근 '근무표 | 내역').
 * 규칙: 주 액션 1개만 노랑 · 라벨 6자 이내·줄바꿈 금지.
 *
 * ★ 아이콘 단독 금지 — 라벨을 반드시 병기한다(워딩 §3).
 * 표시 전용: items를 그대로 그린다.
 */
export function ActionRow({ items }: { items: ActionRowItem[] }) {
  const anyHint = items.some((it) => !!it.hint);
  return (
    <View style={styles.row}>
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
            style={({ pressed }) => [styles.item, i > 0 && styles.divider, pressed && styles.pressed]}
          >
            <View style={[styles.disc, it.primary && styles.discPrimary]}>
              <Ionicons name={it.icon} size={17} color={InkColors.ink} />
              {badge > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.label} numberOfLines={1}>{it.label}</Text>
            {it.hint ? (
              <Text style={styles.hint} numberOfLines={1}>{it.hint}</Text>
            ) : anyHint ? (
              <Text style={styles.hint} accessibilityElementsHidden importantForAccessibility="no"> </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  item: { flex: 1, minWidth: 0, minHeight: ITEM_MIN_H, alignItems: 'center', paddingVertical: Space.md, paddingHorizontal: Space.xs },
  divider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discPrimary: { backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep },
  // 라벨·상태 한 줄은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  label: { marginTop: Space.xs + 2, fontSize: 12, lineHeight: 17, fontWeight: '800', color: InkColors.ink },
  hint: { fontSize: 10.5, lineHeight: 15, color: TextColor.secondary },
  pressed: { opacity: 0.7 },

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
