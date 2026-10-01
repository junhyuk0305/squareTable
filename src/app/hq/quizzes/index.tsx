// /hq/quizzes — 본사 퀴즈(정본 §5-2): 표(제목·문항 수·참조 노하우 수·배포 매장 수·수정일) + 교차표(퀴즈 × 매장)
//                + 다중선택 → [배포] → 대상 매장 고르기(함께 내려갈 노하우를 **미리** 알린다) → 확인.
//
// 재료 = useBrandQuizStore(작업실 원본 + 배포 현황) · useBrandUnitsStore(연결 매장 목록).
// 노하우 화면(/hq/knowhow)과 같은 모양·같은 상태 어휘(deployStatus.ts)다 — 본사가 두 화면을 오가며 같은 뜻으로 읽는다.
// ★작업실 진입(0215)은 스토어 hydrate 가 먼저 한다 — 이 화면은 그 결과만 그린다.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqPill, HqSlab, HqNotice, HqCard, HqEmpty } from '@/components/hq/HqKit';
import { HqTable, Cell, type HqColumn } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { DEPLOY_STATUS, deployStatusMap, cellKey, type DeployStatus } from '@/lib/brand/deployStatus';
import { visibilityLabel, relationLabel, RELATIONS, deployMixNotice, REQUIRED_HINT } from '@/lib/brand/visibility';
import type { BrandQuizRow, BrandCourseDeployResult } from '@/lib/brand/brandDb';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export default function HqQuizzesScreen() {
  const router = useRouter();
  const list = useBrandQuizStore((s) => s.list);
  const matrix = useBrandQuizStore((s) => s.matrix);
  const entryMatrix = useBrandQuizStore((s) => s.entryMatrix);
  const courseEntries = useBrandQuizStore((s) => s.courseEntries);
  const quizLoaded = useBrandQuizStore((s) => s.loaded);
  const error = useBrandQuizStore((s) => s.error);
  const hydrate = useBrandQuizStore((s) => s.hydrate);
  const refresh = useBrandQuizStore((s) => s.refresh);
  const deploy = useBrandQuizStore((s) => s.deploy);
  const overview = useBrandUnitsStore((s) => s.overview);
  const hydrateUnits = useBrandUnitsStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 표·교차표의 행(퀴즈)과 열(연결 매장)이 둘 다 와야 그린다.
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const ready = quizLoaded && unitsLoaded;

  useFocusEffect(useCallback(() => { void hydrate(); void hydrateUnits(); }, [hydrate, hydrateUnits]));

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openDeploy, setOpenDeploy] = useState(false);
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  /** [필수로 내리기](정본 02 §9) — 서버가 **직영 대상만** 켜고, 끄는 길은 여기에 없다(매장 드로어에서만). */
  const [required, setRequired] = useState(false);

  const cells = useMemo(() => deployStatusMap(matrix, (c) => c.course_id), [matrix]);
  const entryCells = useMemo(() => deployStatusMap(entryMatrix, (c) => c.entry_id), [entryMatrix]);
  const statusOf = (courseId: string, unitId: string): DeployStatus =>
    cells.get(cellKey(courseId, unitId))?.status ?? 'none';

  /** 고른 퀴즈들이 담은 노하우 중 그 매장에 사본이 없는 것 — 배포하면 **함께 내려간다**(정본 §4-B "없으면 먼저 자동 배포"). */
  const missingFor = (unitId: string): number => {
    const ids = new Set(courseEntries.filter((r) => picked.has(r.courseId)).map((r) => r.entryId));
    let n = 0;
    ids.forEach((eid) => { if (!entryCells.has(cellKey(eid, unitId))) n++; });
    return n;
  };

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
    setTargets(new Set(overview.map((r) => r.unit_id)));
    setResult(null);
    setDeployErr(null);
    setRequired(false);   // 모달을 열 때마다 꺼진 상태로 — 지난 배포의 체크가 남으면 조용히 강제된다.
    setOpenDeploy(true);
  };

  const runDeploy = async () => {
    setBusy(true);
    setDeployErr(null);
    // 퀴즈마다 RPC 1회(서버가 퀴즈 1건 × 매장 m곳을 한 트랜잭션으로). 하나라도 거부되면 거기서 멈추고 이유를 말한다.
    const all: BrandCourseDeployResult[] = [];
    for (const id of picked) {
      // ★required 는 **직영 대상에만** 걸린다(서버가 relation 으로 거른다). 가맹이 섞여도 거부하지 않는다.
      //   배포와 같은 트랜잭션이라 배포가 거부되면 필수도 같이 되감긴다.
      const r = await deploy(id, [...targets], required);
      if (r.error) { setBusy(false); setDeployErr(r.error); return; }
      all.push(...(r.data ?? []));
    }
    setBusy(false);
    const n = (a: string) => all.filter((x) => x.action === a).length;
    const added = all.reduce((s, x) => s + x.entries_added, 0);
    // 숫자를 그대로 말한다 — '배포 완료'만 띄우면 대기로 빠진 매장을 본사가 모른다.
    setResult(
      [n('created') ? `새로 ${n('created')}곳` : '', n('updated') ? `갱신 ${n('updated')}곳` : '',
       n('pending') ? `새 버전 대기 ${n('pending')}곳` : '', added ? `노하우 ${added}건 함께` : ''].filter(Boolean).join(' · ') || '바뀐 것이 없어요',
    );
    setPicked(new Set());
  };

  // 표는 '무엇을 어디까지 배포했나'까지만 — 쓰는 노하우·수정일은 빌더에서 본다.
  const columns: HqColumn<BrandQuizRow>[] = [
    {
      key: 'pick',
      label: '',
      width: 48,
      render: (r) => <Check on={picked.has(r.id)} onPress={() => toggle(r.id)} label={`${r.name} 고르기`} />,
    },
    {
      // ★행 전체를 Pressable 로 만들지 않는다 — 체크 칸과 중첩 button(메모리 feedback_rnw_nested_button). '고르기'/'열기' 두 Pressable.
      key: 'name',
      label: '제목',
      width: 300,
      render: (r) => (
        <Pressable
          onPress={() => router.push({ pathname: '/hq/quizzes/[id]', params: { id: r.id } })}
          accessibilityRole="link"
          accessibilityLabel={`${r.name} 빌더 열기`}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Cell kind="name">{r.name}</Cell>
        </Pressable>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'items',
      label: '문항',
      width: 90,
      align: 'right',
      // 문항 0개면 보내도 낼 게 없다 — 표에서 바로 말한다(열어 보고 알게 하지 않는다).
      render: (r) => (r.items ? <Cell kind="num">{`${r.items}개`}</Cell> : <Cell kind="muted">없음</Cell>),
      sortValue: (r) => r.items,
    },
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

  const xColumns: HqColumn<BrandQuizRow>[] = [
    { key: 'name', label: '퀴즈', width: 260, render: (r) => <Cell kind="name">{r.name}</Cell> },
    ...overview.map((u) => ({
      key: u.unit_id,
      label: u.store_name,
      width: 128,
      render: (r: BrandQuizRow) => {
        const st = DEPLOY_STATUS[statusOf(r.id, u.unit_id)];
        return <HqPill tone={st.tone} label={st.label} />;
      },
    })),
  ];

  const pickedNoItems = list.filter((r) => picked.has(r.id) && r.items === 0).length;

  // 머리(제목·버튼)는 게이트 밖 — 골격은 즉시 선다.
  const head = {
    title: '퀴즈',
    sub: '본사가 만든 퀴즈를 매장에 보내요. 언제 누구에게 낼지는 점주가 정하고, 발송은 그 매장의 규칙대로 나가요.',
    actions: (
      <>
        <HqButton label="새로고침" icon="refresh-outline" onPress={() => void refresh()} />
        <HqButton label="퀴즈 만들기" icon="add" variant="pri" onPress={() => router.push({ pathname: '/hq/quizzes/[id]', params: { id: 'new' } })} />
      </>
    ),
    testID: 'hq-quizzes',
  };
  if (!ready) {
    return (
      <HqPage {...head}>
        <ScreenLoading label="퀴즈를 불러오고 있어요…" />
      </HqPage>
    );
  }

  return (
    <HqPage {...head}>
      {error ? <HqNotice tone="warn">{error} 새로고침을 눌러 다시 시도해 주세요.</HqNotice> : null}

      <HqSlab
        title="퀴즈"
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
            text="아직 만든 퀴즈가 없어요. 노하우를 고르면 AI가 문항을 만들어요."
            action={<HqButton label="퀴즈 만들기" variant="pri" onPress={() => router.push({ pathname: '/hq/quizzes/[id]', params: { id: 'new' } })} />}
          />
        }
        testID="hq-quizzes-table"
      />

      <HqSlab title="매장별 배포 상태" hint="미배포 · 최신 · 수정됨 · 새 버전 대기 · 숨김" />
      {overview.length === 0 || list.length === 0 ? (
        <HqCard>
          <HqEmpty text={overview.length === 0 ? '연결된 매장이 생기면 교차표가 채워져요.' : '퀴즈를 만들면 교차표가 채워져요.'} />
        </HqCard>
      ) : (
        <HqTable columns={xColumns} rows={list} rowKey={(r) => r.id} testID="hq-quizzes-xtable" />
      )}
      <View style={styles.legend}>
        {(['current', 'modified', 'pending', 'hidden', 'none'] as DeployStatus[]).map((k) => (
          <View key={k} style={styles.legendItem}>
            <HqPill tone={DEPLOY_STATUS[k].tone} label={DEPLOY_STATUS[k].label} />
            <Text style={styles.legendText}>{DEPLOY_STATUS[k].hint}</Text>
          </View>
        ))}
      </View>

      <HqModal
        open={openDeploy}
        title={`퀴즈 ${picked.size}건 보내기`}
        sub="매장에 '아직 안 보냄' 상태로 도착하고 점주에게 알림이 가요. 퀴즈가 쓰는 노하우가 그 매장에 없으면 함께 내려가요. 점주가 고쳐 둔 사본은 덮지 않고 '새 버전 있음'으로 알려요."
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
            {pickedNoItems > 0 ? (
              <HqNotice tone="warn">{`고른 퀴즈 중 ${pickedNoItems}건은 문항이 없어요. 보내도 직원에게 낼 문제가 없어요.`}</HqNotice>
            ) : null}
            <View style={styles.pickBar}>
              <Pressable
                onPress={() => setTargets(targets.size === overview.length ? new Set() : new Set(overview.map((r) => r.unit_id)))}
                accessibilityRole="button"
                accessibilityLabel="대상 매장 전체 선택"
                style={({ pressed }) => [styles.barBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.barBtnText}>{targets.size === overview.length ? '전체 해제' : '전체 선택'}</Text>
              </Pressable>
              {/* 묶음 버튼(정본 02 §9) — 그 관계가 아예 없으면 버튼도 없다. */}
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
              {overview.map((u) => {
                const missing = missingFor(u.unit_id);
                return (
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
                    {/* 함께 내려갈 노하우를 미리 말한다(지시서 §3-2) — 눌러 보고 알게 하지 않는다. */}
                    <Text style={styles.unitVis}>{missing ? `노하우 ${missing}건 함께` : visibilityLabel(u.visibility)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {/* [필수로 내리기] — 직영 대상이 있을 때만. 가맹에는 선택지 자체를 두지 않는다(정본 02 §4). */}
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

/** 체크 칸 — 표 안에서 쓰므로 작게. ★중첩 button 금지라 행 안에서는 장식으로만 쓴다(노하우 화면과 같은 부품). */
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
