// HqDeployStatusPage.tsx — '매장별 배포 상태' 한 화면(노하우·퀴즈 공용). 2026-10-02 하위 메뉴 개편으로
// 목록 화면 아래 섹션에서 자기 화면으로 나왔다(한 화면에 기능 하나). 표·범례는 예전 섹션 그대로.
//
// ★판정은 여기 없다. 상태는 서버가 사본에서 파생한 값(deployStatus.ts)이고 HqDeployCounts 가 세기만 한다.
// 재료는 부르는 화면이 넘긴다 — 노하우/퀴즈 스토어 + 연결 매장(useBrandUnitsStore).
import { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HqPage, HqPill, HqCard, HqEmpty, HqLoadError } from '@/components/hq/HqKit';
import { HqDeployCounts } from '@/components/hq/HqDeployCounts';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear } from '@/components/Appear';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { DEPLOY_STATUS, deployStatusMap, cellKey, type DeployStatus } from '@/lib/brand/deployStatus';
import { InkColors } from '@/lib/theme/colors';

const ORDER: DeployStatus[] = ['current', 'modified', 'pending', 'hidden', 'none'];

export function HqDeployStatusPage<C extends { unit_id: string; status: Exclude<DeployStatus, 'none'> }>({
  kind,
  rows,
  cells,
  idOf,
  loaded,
  error,
  hydrate,
  refresh,
  testID,
}: {
  /** '노하우' · '퀴즈' — 제목·첫 열·빈 문구. */
  kind: string;
  rows: { id: string; title: string }[];
  cells: C[];
  idOf: (c: C) => string;
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  testID: string;
}) {
  const overview = useBrandUnitsStore((s) => s.overview);
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const unitsError = useBrandUnitsStore((s) => s.error);
  const hydrateUnits = useBrandUnitsStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 행(원본)과 열(연결 매장)이 둘 다 와야 그린다.
  const ready = loaded && unitsLoaded;
  const reload = useCallback(() => Promise.all([refresh(), hydrateUnits()]), [refresh, hydrateUnits]);
  useFocusEffect(useCallback(() => { void hydrate(); void hydrateUnits(); }, [hydrate, hydrateUnits]));

  const map = useMemo(() => deployStatusMap(cells, idOf), [cells, idOf]);
  const statusOf = useCallback(
    (id: string, unitId: string): DeployStatus => map.get(cellKey(id, unitId))?.status ?? 'none',
    [map],
  );

  const head = {
    title: '매장별 배포 상태',
    sub: `${kind}마다 몇 곳에 어떤 상태로 있는지예요. 숫자를 누르면 그 매장 목록이 열려요.`,
    testID,
  };
  if (!ready) return <HqPage {...head}><ScreenLoading label={`${kind} 배포 상태를 불러오고 있어요…`} /></HqPage>;
  // 못 읽었으면 표를 그리지 않는다 — 전부 '미배포'로 위장된다.
  if (error || unitsError) {
    return (
      <HqPage {...head}>
        <HqLoadError title={error ? `${kind}를 불러오지 못했어요` : '연결 매장을 불러오지 못했어요'} onRetry={reload} testID={`${testID}-error`} />
      </HqPage>
    );
  }

  return (
    <HqPage {...head}>
      <Appear>
        <View testID={`${testID}-body`}>
        {overview.length === 0 || rows.length === 0 ? (
          <HqCard>
            <HqEmpty text={overview.length === 0 ? '연결된 매장이 생기면 채워져요.' : `${kind}를 만들어 보내면 매장마다 상태가 여기에 모여요.`} />
          </HqCard>
        ) : (
          <HqDeployCounts rows={rows} units={overview} statusOf={statusOf} kind={kind} testID={`${testID}-xtable`} />
        )}
        <View style={styles.legend}>
          {ORDER.map((k) => (
            <View key={k} style={styles.legendItem}>
              <HqPill tone={DEPLOY_STATUS[k].tone} label={DEPLOY_STATUS[k].label} />
              <Text style={styles.legendText}>{DEPLOY_STATUS[k].hint}</Text>
            </View>
          ))}
        </View>
        </View>
      </Appear>
    </HqPage>
  );
}

const styles = StyleSheet.create({
  legend: { gap: 7, marginBottom: 26 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendText: { fontSize: 13.5, color: InkColors.ink3, flex: 1, minWidth: 0 },
});
