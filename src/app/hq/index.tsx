// /hq — 대시보드(정본 §5-2): KPI 스트립 → 확인 필요 → 매장 표 요약. 교차표(매장 × 노하우 숙지)는 P4.
//
// 재료 = useBrandStore(브랜드 이름) · useBrandUnitsStore(brand_overview · brand_invites_list). 숫자는 전부 매장 단위 — 개인 축 0, 랭킹 0.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { HqPage, HqButton, HqPill, HqSlab, HqSegment, HqLoadError } from '@/components/hq/HqKit';
import { HqStrip } from '@/components/hq/HqStrip';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import { visibilityLabel, relationLabel, RELATIONS } from '@/lib/brand/visibility';
import type { BrandRelation } from '@/lib/brand/brandDb';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

/**
 * 대시보드 매장 표는 요약이다 — 상위 10행 + '전체 보기'(쪽 넘김은 매장 화면에만 둔다 · R5 지시).
 * 표가 **전 매장을 정렬한 뒤** 10행을 자르므로 '직원 많은 순'도 전체 기준이다. 10행 ≈ 520px 로 첫 화면 안에 끝난다.
 */
const DASHBOARD_TABLE_ROWS = 10;

export default function HqDashboardScreen() {
  const router = useRouter();
  const brand = useBrandStore((s) => s.brand);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const brandError = useBrandStore((s) => s.error);
  const hydrateBrand = useBrandStore((s) => s.hydrate);
  const overview = useBrandUnitsStore((s) => s.overview);
  const invites = useBrandUnitsStore((s) => s.invites);
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const unitsError = useBrandUnitsStore((s) => s.error);
  const hydrateUnits = useBrandUnitsStore((s) => s.hydrate);
  const knowhowError = useBrandKnowhowStore((s) => s.error);
  const quizError = useBrandQuizStore((s) => s.error);
  // 넷 중 하나라도 못 읽으면 KPI 가 거짓이 된다('배포한 노하우 0건'·'지금 확인할 일이 없어요').
  const error = brandError ?? unitsError ?? knowhowError ?? quizError;
  // '배포한 노하우' = 한 곳 이상에 내려간 작업실 노하우 수(0217 brand_knowhow_list.deployed_units).
  // ★같은 재료를 노하우 화면과 공유한다 — 대시보드가 따로 세면 두 숫자가 어긋난다.
  const deployedCount = useBrandKnowhowStore((s) => s.list.filter((r) => r.deployed_units > 0).length);
  const knowhowLoaded = useBrandKnowhowStore((s) => s.loaded);
  const hydrateKnowhow = useBrandKnowhowStore((s) => s.hydrate);
  // '배포한 퀴즈'(P5) — 같은 규칙: 한 곳 이상에 내려간 작업실 퀴즈 수(0220 brand_quiz_list.deployed_units). 퀴즈 화면과 재료 공유.
  const deployedQuizzes = useBrandQuizStore((s) => s.list.filter((r) => r.deployed_units > 0).length);
  const quizLoaded = useBrandQuizStore((s) => s.loaded);
  const hydrateQuiz = useBrandQuizStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 이 화면이 그리는 원격 소스 넷이 다 와야 그린다. 'KPI 0'이나 '확인할 일 없음'이 먼저 스치지 않는다.
  const ready = brandLoaded && unitsLoaded && knowhowLoaded && quizLoaded;

  // 새로고침·다시 시도·포커스 = 네 재료를 같이.
  const refresh = useCallback(
    () => Promise.all([hydrateBrand(), hydrateUnits(), hydrateKnowhow(), hydrateQuiz()]),
    [hydrateBrand, hydrateUnits, hydrateKnowhow, hydrateQuiz],
  );
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  /**
   * KPI 직영/가맹 토글(정본 02 §9) — 기본은 전체 합산.
   * 성격이 다른 매장이 섞인 평균은 의미가 없다 — 직영 3곳과 가맹 40곳의 숙지율을 한 줄로 섮으면
   * 어느 쪽도 설명하지 못한다. ★매장 표 필터와 **따로** 둔다(층이 다르다 — 지시서 §6 #5).
   * 한 관계만 있는 브랜드에서는 고를 것이 없으므로 토글을 그리지 않는다.
   */
  const [relF, setRelF] = useState<'all' | BrandRelation>('all');
  const mixed = useMemo(
    () => RELATIONS.every((r) => overview.some((u) => u.relation === r.key)),
    [overview],
  );
  const scope = useMemo(
    () => (relF === 'all' || !mixed ? overview : overview.filter((u) => u.relation === relF)),
    [overview, relF, mixed],
  );

  const stats = useMemo(() => {
    const pendingInvites = invites.filter((i) => i.kind === 'store' && i.status === 'pending').length;
    const expiredInvites = invites.filter((i) => i.kind === 'store' && i.status === 'expired').length;
    const visRequests = overview.filter((r) => r.visibility_requested).length;
    const payerToAnswer = overview.filter((r) => r.payer_proposed && !r.payer_proposed_by_brand).length;
    const payerWaiting = overview.filter((r) => r.payer_proposed && r.payer_proposed_by_brand).length;
    // 숙지율: 재료가 있는 매장만 평균. P4 사본 전엔 전부 null → null.
    const withMastery = scope.filter((r) => r.mastery !== null);
    const mastery = withMastery.length ? Math.round((withMastery.reduce((a, r) => a + (r.mastery ?? 0), 0) / withMastery.length) * 100) : null;
    return { pendingInvites, expiredInvites, visRequests, payerToAnswer, payerWaiting, mastery };
  }, [overview, scope, invites]);

  // 보조줄이 "연결 매장 합계"인지 "직영 합계"인지 말해 준다 — 숫자만 바뀌고 설명이 그대로면 오독한다.
  const scopeNote = relF === 'all' || !mixed ? '연결 매장' : `${relationLabel(relF)} 매장`;

  // 0건은 그리지 않는다 — '없음' 칸 네 개는 읽을 것이 없는데 자리만 차지한다.
  const attention = useMemo(
    () =>
      [
        { k: '연결 동의 대기', v: stats.pendingInvites, n: '점주가 앱에서 수락하면 표에 올라와요' },
        { k: '공개 수준 요청 중', v: stats.visRequests, n: '점주가 답을 보고 있어요' },
        { k: '답할 요금 부담 제안', v: stats.payerToAnswer, n: stats.payerWaiting ? `보낸 제안 ${stats.payerWaiting}건은 점주 대기` : '점주가 보낸 제안' },
        { k: '만료된 초대', v: stats.expiredInvites, n: '14일이 지났어요. 다시 보낼 수 있어요' },
      ].filter((a) => a.v > 0),
    [stats],
  );

  // 행 = 그 매장 상세 주소로(push — 뒤로가기가 대시보드로 돌아온다). 목록 화면과 같은 경로를 쓴다.
  const goStores = (unit?: string) => router.push(unit ? { pathname: '/hq/stores/[id]', params: { id: unit } } : '/hq/stores');
  const refreshButton = <HqButton label="새로고침" icon="refresh-outline" onPress={() => void refresh()} />;

  // 머리(제목·새로고침)는 게이트 밖 — 골격은 즉시 선다. 본문은 다 온 뒤에 통째로.
  if (!ready) {
    return (
      <HqPage title="대시보드" actions={refreshButton} testID="hq-dashboard">
        <ScreenLoading label="본사 현황을 불러오고 있어요…" />
      </HqPage>
    );
  }
  // 3분기의 둘째 — 못 읽은 재료가 있으면 숫자를 그리지 않는다(0 으로 위장하지 않는다).
  if (error) {
    return (
      <HqPage title="대시보드" actions={refreshButton} testID="hq-dashboard">
        <HqLoadError title="본사 현황을 불러오지 못했어요" onRetry={refresh} testID="hq-dashboard-error" />
      </HqPage>
    );
  }

  return (
    <HqPage
      title="대시보드"
      sub={brand ? `${brand.brand_name} · 연결 매장 ${overview.length}곳` : undefined}
      actions={refreshButton}
      testID="hq-dashboard"
    >

      {/* 혼합 브랜드에서만 뜬다 — 직영이나 가맹 한쪽뿐이면 고를 것이 없다(빈 토글은 소음이다). */}
      {mixed ? (
        <View style={styles.kpiScope} testID="hq-kpi-scope">
          <Text style={styles.kpiScopeLabel}>KPI 범위</Text>
          <HqSegment
            items={[{ key: 'all', label: '전체' }, ...RELATIONS.map((r) => ({ key: r.key, label: r.label }))]}
            value={relF}
            onChange={setRelF}
          />
        </View>
      ) : null}

      <HqStrip
        testID="hq-kpi"
        items={[
          { label: '연결 매장', value: scope.length, unit: '곳', sub: relF !== 'all' && mixed ? `${relationLabel(relF)}만 · 전체 ${overview.length}곳` : stats.pendingInvites ? `초대 대기 ${stats.pendingInvites}건` : '초대 대기 없음' },
          { label: '배포한 노하우', value: deployedCount, unit: '건', sub: deployedCount ? '한 곳 이상에 내려간 노하우' : '노하우를 쓰고 [배포]를 누르면 세요' },
          { label: '배포한 퀴즈', value: deployedQuizzes, unit: '건', sub: deployedQuizzes ? '한 곳 이상에 내려간 퀴즈 · 발송은 매장이 정해요' : '퀴즈를 만들고 [배포]를 누르면 세요' },
          { label: '숙지율', value: stats.mastery === null ? null : `${stats.mastery}%`, sub: stats.mastery === null ? '배포한 노하우가 생기면 계산돼요' : `${scopeNote} 평균` },
        ]}
      />

      <HqSlab title="확인 필요" hint="본사가 처리할 수 있는 것만 올려요" />
      {attention.length === 0 ? (
        <View style={styles.attNone} testID="hq-attention">
          <Text style={styles.attNoneText}>지금 확인할 일이 없어요.</Text>
        </View>
      ) : (
        <View style={styles.cellcard} testID="hq-attention">
          {attention.map((a) => (
            <AttentionCell key={a.k} k={a.k} v={a.v} n={a.n} onPress={() => goStores()} />
          ))}
        </View>
      )}

      <HqSlab title="매장" hint="이름순 · 행을 누르면 매장 화면에서 연결 정보가 열려요" more={{ label: '전체 보기', onPress: () => goStores() }} />
      <HqTable
        columns={[
          { key: 'name', label: '매장', width: 220, render: (r) => <Cell kind="name">{r.store_name}</Cell> },
          { key: 'vis', label: '공개 수준', width: 130, render: (r) => <HqPill tone={r.visibility === 'ops' ? 'g' : r.visibility === 'knowhow' ? 'i' : 'n'} label={visibilityLabel(r.visibility)} /> },
          { key: 'staff', label: '직원', align: 'right', render: (r) => <Cell kind="num">{r.staff}</Cell>, sortValue: (r) => r.staff },
          { key: 'pq', label: '미해결 질문', align: 'right', render: (r) => <Cell kind="num">{r.pending_q}</Cell>, sortValue: (r) => r.pending_q },
        ]}
        rows={overview}
        rowKey={(r) => r.unit_id}
        onRowPress={(r) => goStores(r.unit_id)}
        maxRows={DASHBOARD_TABLE_ROWS}
        footer={overview.length > DASHBOARD_TABLE_ROWS ? `전체 ${overview.length}곳 중 ${DASHBOARD_TABLE_ROWS}곳` : `${overview.length}곳`}
        testID="hq-dashboard-table"
      />
    </HqPage>
  );
}

function AttentionCell({ k, v, n, onPress }: { k: string; v: number; n: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${k} ${v}건`} style={({ pressed }) => [styles.cell, pressed && { backgroundColor: InkColors.paper }]}>
      <Text style={styles.cellK}>{k}</Text>
      <Text style={[styles.cellV, v === 0 && styles.cellZero]}>{v === 0 ? '없음' : v}</Text>
      <Text style={styles.cellN}>{n}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // KPI 스트립 **위**에 붙인다 — 아래 숫자들의 범위를 정하는 것이라 먼저 읽혀야 한다.
  kpiScope: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  kpiScopeLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  attNone: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingVertical: 18, paddingHorizontal: 18, marginBottom: 22, backgroundColor: InkColors.bg },
  attNoneText: { fontSize: 14, color: InkColors.ink3 },
  cellcard: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, overflow: 'hidden', marginBottom: 22, backgroundColor: InkColors.bg, ...Elevation.e1 },
  cell: { flex: 1, minWidth: 180, paddingVertical: 16, paddingHorizontal: 18, borderLeftWidth: 1, borderLeftColor: InkColors.line, marginLeft: -1 },
  cellK: { fontSize: 14, fontWeight: '600', color: InkColors.ink2, marginBottom: 6 },
  cellV: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: InkColors.ink },
  cellZero: { fontSize: 17, fontWeight: '700', color: InkColors.ink3 },
  cellN: { fontSize: 13, color: InkColors.ink3, marginTop: 4 },
});
