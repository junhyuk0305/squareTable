// HqTable.tsx — 본사 표(데모 `.tcard/.tscroll/th,td`). **행 배열만 받는다** — 데이터 소스에 독립(구현계획 §2).
//
// 정렬 기본값은 부르는 쪽이 정해 넘긴다(정본 §4-A: 본사 = 이름순). 헤더 클릭 정렬은 `sortable` 열만.
// 가로가 좁으면 표만 가로 스크롤한다(페이지 전체가 옆으로 밀리지 않는다).
import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

export type HqColumn<Row> = {
  key: string;
  label: string;
  /** 고정 폭(px). 없으면 내용만큼. */
  width?: number;
  align?: 'left' | 'right';
  render: (row: Row) => ReactNode;
  /** 헤더 클릭 정렬 — 값을 돌려주면 그 값으로 정렬한다(숫자·문자). */
  sortValue?: (row: Row) => number | string | null;
};

/** 고정 폭 열 — `cellBox` 의 flexBasis:0 을 폭으로 덮어야 한다(width 만 주면 basis 0 이 이겨 내용 폭까지 줄어든다 — 2026-09-23 실측). */
const fixed = (w: number) => ({ flexBasis: w, width: w, flexGrow: 0, flexShrink: 0 });

export function HqTable<Row>({
  columns,
  rows,
  rowKey,
  onRowPress,
  selectedKey,
  footer,
  empty,
  testID,
}: {
  columns: HqColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowPress?: (row: Row) => void;
  selectedKey?: string | null;
  footer?: string;
  empty?: ReactNode;
  testID?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      if (x === y) return 0;
      // null(수준 밖·재료 없음)은 어느 방향이든 뒤로 — 숫자가 있는 매장이 먼저다.
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  })();

  return (
    <View style={styles.card} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
        <View style={{ flex: 1, minWidth: '100%' }}>
          <View style={styles.thead}>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const cell = (
                <View style={[styles.hcell, c.align === 'right' && styles.right]}>
                  <Text style={styles.th}>{c.label}</Text>
                  {c.sortValue ? (
                    <Ionicons
                      name={active ? (sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'swap-vertical'}
                      size={12}
                      color={active ? InkColors.ink : InkColors.ink3}
                    />
                  ) : null}
                </View>
              );
              return c.sortValue ? (
                <Pressable
                  key={c.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.label} 정렬`}
                  onPress={() => setSort((s) => (s?.key === c.key ? (s.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: 'desc' }))}
                  style={[styles.cellBox, c.width ? fixed(c.width) : null]}
                >
                  {cell}
                </Pressable>
              ) : (
                <View key={c.key} style={[styles.cellBox, c.width ? fixed(c.width) : null]}>
                  {cell}
                </View>
              );
            })}
          </View>

          {sorted.length === 0 ? (
            <View style={styles.emptyWrap}>{empty ?? <Text style={styles.emptyText}>표시할 매장이 없어요.</Text>}</View>
          ) : (
            sorted.map((row, i) => {
              const k = rowKey(row);
              const selected = selectedKey === k;
              const cells = columns.map((c) => (
                <View key={c.key} style={[styles.cellBox, styles.td, c.width ? fixed(c.width) : null, c.align === 'right' && styles.right]}>
                  {c.render(row)}
                </View>
              ));
              return onRowPress ? (
                <Pressable
                  key={k}
                  testID={`hq-row-${k}`}
                  accessibilityRole="button"
                  onPress={() => onRowPress(row)}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.tr,
                    i > 0 && styles.trBorder,
                    (hovered || pressed) && styles.trHover,
                    selected && styles.trSelected,
                  ]}
                >
                  {cells}
                </Pressable>
              ) : (
                <View key={k} testID={`hq-row-${k}`} style={[styles.tr, i > 0 && styles.trBorder]}>
                  {cells}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
      {footer ? (
        <View style={styles.tfoot}>
          <Text style={styles.tfootText}>{footer}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 표 안 글자 — 이름(굵게)·숫자(tabular)·흐림 셋. */
export function Cell({ children, kind = 'text' }: { children: ReactNode; kind?: 'text' | 'name' | 'num' | 'muted' }) {
  return (
    <Text
      numberOfLines={1}
      style={[styles.cellText, kind === 'name' && styles.name, kind === 'num' && styles.num, kind === 'muted' && styles.muted]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden', marginBottom: 22, ...Elevation.e1 },
  thead: { flexDirection: 'row', backgroundColor: InkColors.paper, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  hcell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  th: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },
  cellBox: { paddingVertical: 11, paddingHorizontal: 16, flexGrow: 1, flexBasis: 0, minWidth: 96, justifyContent: 'center' },
  td: {},
  right: { alignItems: 'flex-end', justifyContent: 'flex-end' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  trBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  trHover: { backgroundColor: '#FCFCFD' },
  trSelected: { backgroundColor: InkColors.paper },
  cellText: { fontSize: 14.5, color: InkColors.ink },
  name: { fontWeight: '700' },
  num: { fontVariant: ['tabular-nums'] },
  muted: { color: InkColors.ink3 },
  emptyWrap: { paddingVertical: 28, alignItems: 'center' },
  emptyText: { fontSize: 14.5, color: InkColors.ink3 },
  tfoot: { paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: InkColors.line },
  tfootText: { fontSize: 14, color: InkColors.ink2 },
});
