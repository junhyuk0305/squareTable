// HqDeployCounts.tsx — 매장별 배포 상태를 **상태별 매장 수**로 보여 주는 표(노하우·퀴즈 공용 · 표시 전용).
//
// 왜: 예전 교차표는 칸이 매장 수만큼이었다(노하우 100 × 매장 50 = 5,000칸). 행 쪽 나누기로는 안 풀리고
//   매장 50개 칸은 사람이 읽을 수 없다. 본사가 알고 싶은 것은 "어느 노하우가 몇 곳에 아직 안 갔나"다.
//   → 칸 = 상태 5개(고정). 숫자를 누르면 그 상태인 매장 목록 → 매장을 누르면 매장 상세.
// ★판정은 여기 없다. 상태는 서버가 사본에서 파생한 값(deployStatus.ts)이고, 여기서는 **세기만** 한다.
// ★칸 안 숫자는 Pressable 이다 — 표 행에 onRowPress 를 주지 않는다(RNW 중첩 button: 바깥이 안쪽 클릭을 먹는다).
import { useMemo, useState } from 'react';
import { Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPill } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { DEPLOY_STATUS, type DeployStatus } from '@/lib/brand/deployStatus';
import { relationLabel, visibilityLabel } from '@/lib/brand/visibility';
import type { BrandOverviewRow } from '@/lib/brand/brandDb';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 칸 순서 — 범례와 같다. 미배포는 맨 끝(본사가 손쓸 칸이라 눈이 마지막에 머문다). */
const ORDER: DeployStatus[] = ['current', 'modified', 'pending', 'hidden', 'none'];

type Row = { id: string; title: string };

export function HqDeployCounts({
  rows,
  units,
  statusOf,
  kind,
  testID,
}: {
  rows: Row[];
  /** 연결 매장 전부 — 상태별 수의 합 = 이 수. */
  units: BrandOverviewRow[];
  statusOf: (id: string, unitId: string) => DeployStatus;
  /** 첫 열 머리글·목록 제목 — '노하우' · '퀴즈'. */
  kind: string;
  testID?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ row: Row; status: DeployStatus } | null>(null);

  // 행마다 상태별 매장 목록(이름순 — units 가 이미 이름순). 숫자도 목록도 이 한 번의 셈에서 나온다.
  const byStatus = useMemo(() => {
    const m = new Map<string, Record<DeployStatus, BrandOverviewRow[]>>();
    for (const r of rows) {
      const g: Record<DeployStatus, BrandOverviewRow[]> = { current: [], modified: [], pending: [], hidden: [], none: [] };
      for (const u of units) g[statusOf(r.id, u.unit_id)].push(u);
      m.set(r.id, g);
    }
    return m;
  }, [rows, units, statusOf]);

  const columns: HqColumn<Row>[] = [
    { key: 'title', label: kind, width: 260, render: (r) => <Cell kind="name">{r.title}</Cell>, sortValue: (r) => r.title },
    ...ORDER.map((st) => ({
      key: st,
      label: DEPLOY_STATUS[st].label,
      align: 'right' as const,
      // 머리글로 정렬할 수 있다 — "미배포 많은 순"이 본사가 제일 먼저 보는 줄이다.
      sortValue: (r: Row) => byStatus.get(r.id)?.[st].length ?? 0,
      render: (r: Row) => {
        const n = byStatus.get(r.id)?.[st].length ?? 0;
        if (n === 0) return <Cell kind="muted">—</Cell>;
        return (
          <Pressable
            onPress={() => setOpen({ row: r, status: st })}
            accessibilityRole="button"
            accessibilityLabel={`${r.title} ${DEPLOY_STATUS[st].label} ${n}곳 보기`}
            testID={`${testID ?? 'hq-counts'}-${r.id}-${st}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.count, (hovered || pressed) && styles.countHover]}
          >
            <Text style={styles.countText}>{n}곳</Text>
          </Pressable>
        );
      },
    })),
  ];

  const list = open ? byStatus.get(open.row.id)?.[open.status] ?? [] : [];

  return (
    <>
      <HqTable columns={columns} rows={rows} rowKey={(r) => r.id} footer={`연결 매장 ${units.length}곳 기준`} testID={testID} />

      <HqModal
        open={!!open}
        title={open?.row.title ?? ''}
        sub={open ? `${DEPLOY_STATUS[open.status].label} ${list.length}곳 · ${DEPLOY_STATUS[open.status].hint}` : undefined}
        width={520}
        onClose={() => setOpen(null)}
      >
        <ScrollView style={styles.list} testID={testID ? `${testID}-stores` : undefined}>
          {list.map((u, i) => (
            <Pressable
              key={u.unit_id}
              onPress={() => {
                setOpen(null);
                router.push({ pathname: '/hq/stores/[id]', params: { id: u.unit_id } });
              }}
              accessibilityRole="link"
              accessibilityLabel={`${u.store_name} 매장 열기`}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.unitRow, i > 0 && styles.unitBorder, (hovered || pressed) && styles.countHover]}
            >
              <Text style={styles.unitName} numberOfLines={1}>{u.store_name}</Text>
              <HqPill tone={u.relation === 'direct' ? 'i' : 'n'} label={relationLabel(u.relation)} />
              <Text style={styles.unitVis}>{visibilityLabel(u.visibility)}</Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          ))}
        </ScrollView>
      </HqModal>
    </>
  );
}

const styles = StyleSheet.create({
  count: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: Space.sm, borderRadius: Radius.sm, minHeight: 32, justifyContent: 'center' },
  countHover: { backgroundColor: InkColors.paper },
  countText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink, textDecorationLine: 'underline', fontVariant: ['tabular-nums'] },
  list: { maxHeight: 360, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 10, paddingHorizontal: 14, minHeight: 48 },
  unitBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  unitName: { flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: '600', color: InkColors.ink },
  unitVis: { fontSize: 13, color: InkColors.ink3, width: 72, textAlign: 'right' },
});
