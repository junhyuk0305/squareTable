// /hq/knowhow — 본사 노하우(정본 §5-2): 표(제목·섹션·버전·배포 매장 수·수정일) + 상태별 매장 수(노하우 × 배포 상태 5칸)
//                + 다중선택 → [배포] → 대상 매장 고르기 → 확인.
//
// 재료 = useBrandKnowhowStore(작업실 원본 + 배포 현황) · useBrandUnitsStore(연결 매장 목록).
// ★작업실 진입(0215)은 스토어 hydrate 가 먼저 한다 — 이 화면은 그 결과만 그린다.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqPill, HqSlab, HqNotice, HqCard, HqEmpty, HqLoadError } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { HqDeployCounts } from '@/components/hq/HqDeployCounts';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear, stagger } from '@/components/Appear';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { DEPLOY_STATUS, deployStatusMap, cellKey, type DeployStatus } from '@/lib/brand/deployStatus';
import { visibilityLabel, relationLabel, RELATIONS, deployMixNotice, REQUIRED_HINT } from '@/lib/brand/visibility';
import type { BrandKnowhowRow } from '@/lib/brand/brandDb';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export default function HqKnowhowScreen() {
  const router = useRouter();
  const list = useBrandKnowhowStore((s) => s.list);
  const matrix = useBrandKnowhowStore((s) => s.matrix);
  const knowhowLoaded = useBrandKnowhowStore((s) => s.loaded);
  const error = useBrandKnowhowStore((s) => s.error);
  const hydrate = useBrandKnowhowStore((s) => s.hydrate);
  const refresh = useBrandKnowhowStore((s) => s.refresh);
  const deploy = useBrandKnowhowStore((s) => s.deploy);
  const overview = useBrandUnitsStore((s) => s.overview);
  const hydrateUnits = useBrandUnitsStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 표·교차표의 행(노하우)과 열(연결 매장)이 둘 다 와야 그린다.
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const unitsError = useBrandUnitsStore((s) => s.error);
  const ready = knowhowLoaded && unitsLoaded;
  // 새로고침·다시 시도 = 두 재료를 같이. 한쪽만 다시 받으면 행과 매장 수가 서로 다른 시점이 된다.
  const reload = useCallback(() => Promise.all([refresh(), hydrateUnits()]), [refresh, hydrateUnits]);

  useFocusEffect(useCallback(() => { void hydrate(); void hydrateUnits(); }, [hydrate, hydrateUnits]));

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openDeploy, setOpenDeploy] = useState(false);
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  /** [필수로 내리기](정본 02 §9) — 서버가 **직영 대상만** 켜고, 끄는 길은 여기에 없다(매장 드로어에서만). */
  const [required, setRequired] = useState(false);

  const cells = useMemo(() => deployStatusMap(matrix, (c) => c.entry_id), [matrix]);
  const statusOf = useCallback(
    (entryId: string, unitId: string): DeployStatus => cells.get(cellKey(entryId, unitId))?.status ?? 'none',
    [cells],
  );
  const countRows = useMemo(() => list.map((r) => ({ id: r.id, title: r.title })), [list]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const allPicked = list.length > 0 && picked.size === list.length;

  // 고른 대상 중 직영만 — [필수로 내리기] 표시 여부와 "미리 말하기" 문장이 둘 다 이 목록에서 나온다.
  const directTargets = useMemo(
    () => overview.filter((u) => targets.has(u.unit_id) && u.relation === 'direct'),
    [overview, targets],
  );
  const mixNotice = useMemo(
    () => deployMixNotice(overview.filter((u) => targets.has(u.unit_id)), required),
    [overview, targets, required],
  );

  const openDeployModal = () => {
    // 기본 대상 = 연결 매장 전체(본사가 노하우를 만든 이유는 대개 전 매장이다). 빼는 것은 체크로.
    setTargets(new Set(overview.map((r) => r.unit_id)));
    setResult(null);
    setDeployErr(null);
    setRequired(false);   // 모달을 열 때마다 꺼진 상태로 — 지난 배포의 체크가 남으면 조용히 강제된다.
    setOpenDeploy(true);
  };

  const runDeploy = async () => {
    setBusy(true);
    setDeployErr(null);
    // ★required 는 **직영 대상에만** 걸린다(서버가 relation 으로 거른다). 가맹이 섞여도 거부하지 않는다.
    const r = await deploy([...picked], [...targets], required);
    setBusy(false);
    if (r.error) { setDeployErr(r.error); return; }
    const rows = r.data ?? [];
    const n = (a: string) => rows.filter((x) => x.action === a).length;
    // 숫자를 그대로 말한다 — '배포 완료'만 띄우면 대기로 빠진 매장을 본사가 모른다.
    setResult(
      [n('created') ? `새로 ${n('created')}곳` : '', n('updated') ? `갱신 ${n('updated')}곳` : '',
       n('pending') ? `새 버전 대기 ${n('pending')}곳` : ''].filter(Boolean).join(' · ') || '바뀐 것이 없어요',
    );
    setPicked(new Set());
  };

  // 표는 '무엇을 어디까지 배포했나'까지만 — 사진 수·수정일 같은 세부는 편집기에서 본다.
  const columns: HqColumn<BrandKnowhowRow>[] = [
    {
      key: 'pick',
      label: '',
      width: 48,
      render: (r) => <Check on={picked.has(r.id)} onPress={() => toggle(r.id)} label={`${r.title} 고르기`} />,
    },
    {
      // ★행 전체를 Pressable 로 만들지 않는다 — 체크 칸(Pressable)이 그 안에 들어가면 RNW 에서
      //   중첩 button 이 되어 바깥이 안쪽 클릭을 먹는다(메모리 feedback_rnw_nested_button).
      //   그래서 '고르기'와 '열기'를 **나란한 두 Pressable** 로 나눈다.
      key: 'title',
      label: '제목',
      width: 300,
      render: (r) => (
        <Pressable
          onPress={() => router.push({ pathname: '/hq/knowhow/[id]', params: { id: r.id } })}
          accessibilityRole="link"
          accessibilityLabel={`${r.title} 편집기 열기`}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Cell kind="name">{r.title}</Cell>
        </Pressable>
      ),
      sortValue: (r) => r.title,
    },
    { key: 'section', label: '섹션', width: 140, render: (r) => <Cell kind="muted">{r.section || '미분류'}</Cell>, sortValue: (r) => r.section ?? '' },
    {
      key: 'ver',
      label: '배포 버전',
      width: 110,
      align: 'right',
      render: (r) => (r.version ? <Cell kind="num">{`v${r.version}`}</Cell> : <Cell kind="muted">—</Cell>),
      sortValue: (r) => r.version,
    },
    {
      key: 'units',
      label: '배포 매장',
      width: 110,
      align: 'right',
      render: (r) => (r.deployed_units ? <Cell kind="num">{`${r.deployed_units}곳`}</Cell> : <Cell kind="muted">—</Cell>),
      sortValue: (r) => r.deployed_units,
    },
  ];

  // 머리(제목·버튼)는 게이트 밖 — 골격은 즉시 선다.
  const head = {
    title: '노하우',
    sub: '본사가 쓴 노하우를 매장에 보내요. 점주는 받은 노하우를 고치거나 이 매장에서 숨길 수 있어요.',
    actions: (
      <>
        <HqButton label="새로고침" icon="refresh-outline" onPress={() => void reload()} />
        <HqButton label="노하우 쓰기" icon="add" variant="pri" onPress={() => router.push({ pathname: '/hq/knowhow/[id]', params: { id: 'new' } })} />
      </>
    ),
    testID: 'hq-knowhow',
  };
  if (!ready) {
    return (
      <HqPage {...head}>
        <ScreenLoading label="노하우를 불러오고 있어요…" />
      </HqPage>
    );
  }
  // 3분기의 둘째 — 못 읽었으면 표를 그리지 않는다. 그리면 "아직 쓴 노하우가 없어요"·"연결된 매장이 없어
  // 보낼 곳이 없어요"·전부 '미배포' 같은 **정상 문구로 장애가 위장된다**.
  if (error || unitsError) {
    return (
      <HqPage {...head}>
        <HqLoadError
          title={error ? '노하우를 불러오지 못했어요' : '연결 매장을 불러오지 못했어요'}
          onRetry={reload}
          testID="hq-knowhow-error"
        />
      </HqPage>
    );
  }

  return (
    <HqPage {...head}>
      {/* 등장은 섹션 단위로(ui.md ⑤) — 노하우 표 → 배포 상태 순서로. */}
      <Appear>
        <HqSlab
          title="노하우"
          hint={picked.size ? `${picked.size}건 선택` : '왼쪽 칸을 눌러 여러 건을 고른 뒤 한 번에 보낼 수 있어요'}
        />
        <View style={styles.bar}>
          <Pressable
            onPress={() => setPicked(allPicked ? new Set() : new Set(list.map((r) => r.id)))}
            accessibilityRole="button"
            accessibilityLabel={allPicked ? '전체 선택 해제' : '전체 선택'}
            style={({ pressed }) => [styles.barBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.barBtnText}>{allPicked ? '전체 해제' : '전체 선택'}</Text>
          </Pressable>
          <HqButton
            label={picked.size ? `${picked.size}건 배포` : '배포'}
            icon="paper-plane-outline"
            variant="dark"
            disabled={picked.size === 0 || overview.length === 0}
            onPress={openDeployModal}
          />
          {overview.length === 0 ? <Text style={styles.barNote}>연결된 매장이 없어 아직 보낼 곳이 없어요.</Text> : null}
        </View>

        <HqTable
          columns={columns}
          rows={list}
          rowKey={(r) => r.id}
          footer={`${list.length}건`}
          empty={
            <HqEmpty
              text="아직 쓴 노하우가 없어요. 붙여넣기만 해도 AI가 카드로 정리해요."
              action={<HqButton label="노하우 쓰기" variant="pri" onPress={() => router.push({ pathname: '/hq/knowhow/[id]', params: { id: 'new' } })} />}
            />
          }
          testID="hq-knowhow-table"
        />
      </Appear>

      <Appear delay={stagger(1)}>
        <HqSlab title="매장별 배포 상태" hint="숫자를 누르면 그 매장 목록이 열려요" />
        {overview.length === 0 || list.length === 0 ? (
          <HqCard>
            <HqEmpty text={overview.length === 0 ? '연결된 매장이 생기면 채워져요.' : '노하우를 쓰고 보내면 매장마다 상태가 여기에 모여요.'} />
          </HqCard>
        ) : (
          <HqDeployCounts rows={countRows} units={overview} statusOf={statusOf} kind="노하우" testID="hq-knowhow-xtable" />
        )}
        <View style={styles.legend}>
          {(['current', 'modified', 'pending', 'hidden', 'none'] as DeployStatus[]).map((k) => (
            <View key={k} style={styles.legendItem}>
              <HqPill tone={DEPLOY_STATUS[k].tone} label={DEPLOY_STATUS[k].label} />
              <Text style={styles.legendText}>{DEPLOY_STATUS[k].hint}</Text>
            </View>
          ))}
        </View>
      </Appear>

      <HqModal
        open={openDeploy}
        title={`노하우 ${picked.size}건 보내기`}
        sub="고른 매장에 즉시 도착하고 점주에게 알림이 가요. 점주가 고쳐 둔 사본은 덮지 않고 '새 버전 있음'으로 알려요."
        width={560}
        onClose={() => setOpenDeploy(false)}
      >
        {deployErr ? <HqNotice tone="warn">{deployErr}</HqNotice> : null}
        {result ? (
          <>
            <HqNotice tone="i">{result}에 보냈어요.</HqNotice>
            <HqButton label="닫기" variant="pri" onPress={() => setOpenDeploy(false)} />
          </>
        ) : (
          <>
            <View style={styles.pickBar}>
              <Pressable
                onPress={() => setTargets(targets.size === overview.length ? new Set() : new Set(overview.map((r) => r.unit_id)))}
                accessibilityRole="button"
                accessibilityLabel="대상 매장 전체 선택"
                style={({ pressed }) => [styles.barBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.barBtnText}>{targets.size === overview.length ? '전체 해제' : '전체 선택'}</Text>
              </Pressable>
              {/* 묶음 버튼(정본 02 §9) — 혼합 브랜드에서 "직영 3곳에만"이 잦은데 40줄에서 3개를 찾아
                  체크하게 두면 실수가 난다. 그 관계가 아예 없으면 버튼도 없다(빈 버튼은 소음이다). */}
              {RELATIONS.map((rel) =>
                overview.some((u) => u.relation === rel.key) ? (
                  <Pressable
                    key={rel.key}
                    onPress={() => setTargets(new Set(overview.filter((u) => u.relation === rel.key).map((u) => u.unit_id)))}
                    accessibilityRole="button"
                    accessibilityLabel={`${rel.label} 매장만 고르기`}
                    style={({ pressed }) => [styles.barBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.barBtnText}>{rel.label} 전체</Text>
                  </Pressable>
                ) : null,
              )}
              <Text style={styles.barNote}>{targets.size}곳 선택</Text>
            </View>
            <View style={styles.unitList}>
              {overview.map((u) => (
                <Pressable
                  key={u.unit_id}
                  onPress={() =>
                    setTargets((t) => {
                      const n = new Set(t);
                      if (n.has(u.unit_id)) n.delete(u.unit_id); else n.add(u.unit_id);
                      return n;
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: targets.has(u.unit_id) }}
                  accessibilityLabel={u.store_name}
                  style={({ pressed }) => [styles.unitRow, pressed && { backgroundColor: InkColors.paper }]}
                >
                  <Check on={targets.has(u.unit_id)} onPress={() => {}} label="" />
                  <Text style={styles.unitName} numberOfLines={1}>{u.store_name}</Text>
                  <Text style={styles.unitRel}>{relationLabel(u.relation)}</Text>
                  <Text style={styles.unitVis}>{visibilityLabel(u.visibility)}</Text>
                </Pressable>
              ))}
            </View>
            {/* [필수로 내리기] — 직영 대상이 있을 때만 뜬다. 가맹에는 걸 수 없으므로 **선택지 자체를 두지 않는다**
                (정본 02 §4: "점주가 동의하면 허용"을 만들지 않는 것이 방어선이다). */}
            {directTargets.length > 0 ? (
              <Pressable
                onPress={() => setRequired((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: required }}
                accessibilityLabel="필수로 내리기"
                testID="hq-deploy-required"
                style={({ pressed }) => [styles.reqRow, pressed && { opacity: 0.8 }]}
              >
                <Check on={required} onPress={() => {}} label="" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reqName}>필수로 내리기 (직영 {directTargets.length}곳)</Text>
                  <Text style={styles.reqHint}>{REQUIRED_HINT}</Text>
                </View>
              </Pressable>
            ) : null}
            {mixNotice ? <HqNotice tone="i">{mixNotice}</HqNotice> : null}
            <HqButton
              label={busy ? '보내는 중…' : `${targets.size}곳에 보내기`}
              variant="pri"
              disabled={busy || targets.size === 0}
              onPress={() => void runDeploy()}
            />
          </>
        )}
      </HqModal>
    </HqPage>
  );
}

/** 체크 칸 — 표 안에서 쓰므로 작게. ★중첩 button 금지(메모리 feedback_rnw_nested_button)라 행 안에서는 장식으로만 쓴다. */
function Check({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  if (!label) {
    return (
      <View style={[styles.box, on && styles.boxOn]}>
        {on ? <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} /> : null}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.boxHit, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.box, on && styles.boxOn]}>
        {on ? <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 12 },
  barBtn: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, minHeight: 40, justifyContent: 'center' },
  barBtnText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  barNote: { fontSize: 13.5, color: InkColors.ink3 },

  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  boxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  boxHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },

  legend: { gap: 7, marginBottom: 26 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendText: { fontSize: 13.5, color: InkColors.ink3, flex: 1, minWidth: 0 },

  pickBar: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 10 },
  unitList: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, overflow: 'hidden', marginBottom: 16, maxHeight: 320 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 48, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  unitName: { flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: '600', color: InkColors.ink },
  unitRel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  reqRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, paddingVertical: 10, marginBottom: 12 },
  reqName: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  reqHint: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3, marginTop: 2 },
  unitVis: { fontSize: 13, color: InkColors.ink3 },
});
