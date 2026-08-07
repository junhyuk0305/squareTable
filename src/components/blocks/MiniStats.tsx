import { View, Text, Pressable, StyleSheet } from 'react-native';

import { InfoDot } from '@/components/InfoDot';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

export type MiniStatsItem = {
  key: string;
  value: string | number;
  label: string;
  onPress?: () => void;
  /**
   * 라벨만으로 뜻이 안 서는 지표의 ⓘ 설명(예: '대신 답함').
   * KPI 카드를 이 한 줄로 흡수하면서 카드가 이고 있던 설명이 갈 곳을 잃는다 → 여기로 받는다(2026-08-06).
   */
  info?: { title: string; body: string };
};

/**
 * I3 · 미니 통계 3~4칸 — 상하 보더 + 세로 구분선. **카드가 아니다.**
 *
 * KPI 카드 여러 장을 이 한 줄로 흡수해 "카드의 나열"을 끊는 자리다.
 * 표시 전용: 숫자 포맷은 호출부에서 끝낸다.
 */
export function MiniStats({ items }: { items: MiniStatsItem[] }) {
  if (items.length === 0) return null;

  return (
    <View style={styles.row}>
      {items.map((it, i) => {
        const body = (
          <>
            <Text style={styles.value}>{it.value}</Text>
            <View style={styles.labelRow}>
              <Text style={[styles.label, styles.labelText]} numberOfLines={1}>{it.label}</Text>
              {it.info ? <InfoDot size={13} title={it.info.title} body={it.info.body} /> : null}
            </View>
          </>
        );
        return (
          <View key={it.key} style={[styles.cell, i > 0 && styles.divider]}>
            {it.onPress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${it.label} ${it.value}`}
                onPress={it.onPress}
                style={({ pressed }) => [styles.cellInner, pressed && styles.pressed]}
              >
                {body}
              </Pressable>
            ) : (
              <View style={styles.cellInner}>{body}</View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: InkColors.line,
  },
  cell: { flex: 1 },
  divider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  cellInner: { alignItems: 'center', gap: Space.xs, paddingVertical: Space.md, paddingHorizontal: Space.xs },
  pressed: { opacity: 0.6 },
  value: { fontSize: 20, lineHeight: 27, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%' },
  labelText: { flexShrink: 1 },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '700', color: InkColors.ink2 },
});
