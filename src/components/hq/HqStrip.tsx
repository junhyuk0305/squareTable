// HqStrip.tsx — KPI 스트립(데모 `.strip`). 칸마다 라벨·값·단위·보조줄. 값이 null 이면 '—'(재료 없음, 0 이 아니다).
import { View, Text, StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

export type StripItem = { label: string; value: number | string | null; unit?: string; sub?: string };

export function HqStrip({ items, testID }: { items: StripItem[]; testID?: string }) {
  return (
    <View style={styles.strip} testID={testID}>
      {items.map((it, i) => (
        <View key={it.label} style={[styles.cell, i > 0 && styles.cellBorder]}>
          <Text style={styles.lab}>{it.label}</Text>
          <View style={styles.valRow}>
            <Text style={[styles.val, it.value === null && styles.valNull]}>
              {it.value === null ? '—' : typeof it.value === 'number' ? it.value.toLocaleString() : it.value}
            </Text>
            {it.unit && it.value !== null ? <Text style={styles.unit}>{it.unit}</Text> : null}
          </View>
          {it.sub ? <Text style={styles.sub}>{it.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden', marginBottom: 22, ...Elevation.e1 },
  cell: { flex: 1, minWidth: 0, paddingVertical: 16, paddingHorizontal: 20 },
  cellBorder: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  lab: { fontSize: 12, fontWeight: '600', color: InkColors.ink2, marginBottom: 5 },
  valRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  val: { fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: InkColors.ink, lineHeight: 28 },
  valNull: { color: InkColors.ink3, fontWeight: '700' },
  unit: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  sub: { fontSize: 11.5, color: InkColors.ink3, marginTop: 3 },
});
