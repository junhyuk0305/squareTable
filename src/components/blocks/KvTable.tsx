import { View, Text, StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 키 열 고정폭 — 값 열의 좌측 시작점을 한 축으로 묶는 게 이 블록의 전부다. */
const KEY_WIDTH = 112;

export type KvRow = { key: string; value: string };

/**
 * D2 · 2열 줄무늬 표 (상황↔대응) — 노하우 본문을 "상황 / 할 일 / 금지"로 훑게 한다.
 *
 * 왜 표인가: 문단으로 쓰면 읽어야 알고, 표로 쓰면 훑어서 안다.
 * 예외·주의처럼 튀어야 하는 것은 이 표에 넣지 말고 SquareCard의 좌측 컬러바로 남긴다
 * (용처가 안 겹쳐 병용한다 — 2026-08-07 적용 데모).
 *
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function KvTable({ rows }: { rows: KvRow[] }) {
  if (rows.length === 0) return null;

  return (
    <View style={styles.table}>
      {rows.map((r, i) => (
        <View
          key={r.key}
          style={[
            styles.row,
            i % 2 === 1 && styles.rowAlt,
            i === rows.length - 1 && styles.rowLast,
          ]}
        >
          <Text style={styles.key}>{r.key}</Text>
          <Text style={styles.value}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    backgroundColor: InkColors.bg,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: InkColors.line },
  rowAlt: { backgroundColor: InkColors.bgSoft },
  rowLast: { borderBottomWidth: 0 },
  key: {
    width: KEY_WIDTH,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    borderRightWidth: 1,
    borderRightColor: InkColors.line,
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '800',
    color: InkColors.ink2,
  },
  value: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    // 본문(읽어서 판단하는 문장)이라 15sp 하한 적용 — 정본 HTML의 13px은 웹 목업 값이다.
    fontSize: 15,
    lineHeight: 21,
    color: InkColors.ink,
  },
});
