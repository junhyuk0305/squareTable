// 허브 공용 매장 선택 시트 — "여러 매장에 걸친 항목"을 어느 매장에서 볼지 사장이 고른다.
// 진입점: 현황 탭 확인 필요 행(건수가 2+ 매장에 흩어질 때) · 노하우 탭 노하우 담기(다점포).
// 원칙: 매장 1곳뿐이면 이 시트를 띄우지 않고 바로 이동한다(불필요한 탭 1회 방지) — 판단은 호출부.
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export type StorePickerRow = {
  uid: string;
  label: string;
  color: string;
  /** 행 우측 건수 배지 — 없으면 배지를 그리지 않는다(담기처럼 건수가 없는 흐름). */
  count?: number;
};

export function StorePickerSheet({
  visible,
  title,
  hint,
  rows,
  currentUid,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  hint: string;
  rows: StorePickerRow[];
  /** 지금 보고 있는 매장 uid — 행에 '현재 매장' 표시(전환기처럼 현 매장도 목록에 넣는 흐름용). */
  currentUid?: string;
  onPick: (uid: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {rows.map((r, i) => {
          const isCurrent = currentUid != null && r.uid === currentUid;
          return (
            <Pressable
              key={r.uid}
              onPress={() => onPick(r.uid)}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowTop, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={isCurrent ? `${r.label}, 현재 매장` : `${r.label} 선택`}
            >
              <View style={[styles.dot, { backgroundColor: r.color }]} />
              <Text style={styles.rowTitle} numberOfLines={1}>{r.label}</Text>
              {isCurrent && <Text style={styles.currentBadge}>현재 매장</Text>}
              {r.count != null && <Text style={styles.cnt}>{r.count}</Text>}
              {isCurrent ? (
                <Ionicons name="checkmark" size={15} color={InkColors.ink} />
              ) : (
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '70%', paddingBottom: Space.xl },
  title: {
    fontSize: 16, fontWeight: '900', color: InkColors.ink,
    paddingHorizontal: Space.gutter, paddingTop: Space.sm,
  },
  hint: { fontSize: 12.5, color: InkColors.ink3, paddingHorizontal: Space.gutter, marginTop: 2 },
  list: { paddingHorizontal: Space.gutter, marginTop: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  currentBadge: {
    fontSize: 11, fontWeight: '800', color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.xs + 2, paddingVertical: 2, borderRadius: Radius.pill, overflow: 'hidden',
  },
  cnt: {
    minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: '900', color: '#8a5a12',
    backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: Space.xs + 2, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },
});
