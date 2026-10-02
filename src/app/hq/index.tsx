// /hq — 대시보드(정본 §5-2): KPI 스트립 → [확인 필요 | 매장 현황] 두 칸. 하위 메뉴가 없는 한 장이다.
// 2026-10-02 레퍼런스 개편: 세 덩어리를 세로로 쌓던 것을 숫자 줄 아래 두 칸으로 — 한 화면에서 '할 일'과 '매장'을 같이 본다.
// KPI 범위(직영/가맹) 토글은 머리 줄 오른쪽으로 갔다 — 아래 숫자 전부의 범위라 화면 머리에 둔다.
//
// 재료 = useBrandStore(브랜드 이름) · useBrandUnitsStore(brand_overview · brand_invites_list). 숫자는 전부 매장 단위 — 개인 축 0, 랭킹 0.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { HqPage, HqPill, HqSlab, HqSegment, HqLoadError, HqCard } from '@/components/hq/HqKit';
import { HqStrip } from '@/components/hq/HqStrip';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear } from '@/components/Appear';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import { visibilityLabel, relationLabel, RELATIONS, VIS_TONE } from '@/lib/brand/visibility';
import type { BrandRelation } from '@/lib/brand/brandDb';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

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

  // 다시 시도·포커스 = 네 재료를 같이.
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
        { k: '연결 동의 대기', v: stats.pendingInvites, n: '점주가 앱에서 수락하면 전체 매장에 올라와요', to: 'invites' as const },
        { k: '공개 수준 요청 중', v: stats.visRequests, n: '점주가 답을 보고 있어요', to: 'stores' as const },
        { k: '답할 요금 부담 제안', v: stats.payerToAnswer, n: stats.payerWaiting ? `보낸 제안 ${stats.payerWaiting}건은 점주 대기` : '점주가 보낸 제안', to: 'stores' as const },
        { k: '만료된 초대', v: stats.expiredInvites, n: '14일이 지났어요. 다시 보낼 수 있어요', to: 'invites' as const },
      ].filter((a) => a.v > 0),
    [stats],
  );

  // 행 = 그 매장 상세 주소로(push — 뒤로가기가 대시보드로 돌아온다). 목록 화면과 같은 경로를 쓴다.
  const goStores = (unit?: string) => router.push(unit ? { pathname: '/hq/stores/[id]', params: { id: unit } } : '/hq/stores');
  // 혼합 브랜드에서만 뜬다 — 직영이나 가맹 한쪽뿐이면 고를 것이 없다(빈 토글은 소음이다).
  const scopeToggle = mixed ? (
    <View style={styles.kpiScope} testID="hq-kpi-scope">
      <Text style={styles.kpiScopeLabel}>KPI 범위</Text>
      <HqSegment
        items={[{ key: 'all', label: '전체' }, ...RELATIONS.map((r) => ({ key: r.key, label: r.label }))]}
        value={relF}
        onChange={setRelF}
      />
    </View>
  ) : null;

  // 머리(제목)는 게이트 밖 — 골격은 즉시 선다. 본문은 다 온 뒤에 통째로.
  if (!ready) {
    return (
      <HqPage title="대시보드" testID="hq-dashboard">
        <ScreenLoading label="본사 현황을 불러오고 있어요…" />
      </HqPage>
    );
  }
  // 3분기의 둘째 — 못 읽은 재료가 있으면 숫자를 그리지 않는다(0 으로 위장하지 않는다).
  if (error) {
    return (
      <HqPage title="대시보드" testID="hq-dashboard">
        <HqLoadError title="본사 현황을 불러오지 못했어요" onRetry={refresh} testID="hq-dashboard-error" />
      </HqPage>
    );
  }

  return (
    <HqPage
      title="대시보드"
      sub={brand ? `${brand.brand_name} · 연결 매장 ${overview.length}곳` : undefined}
      actions={scopeToggle}
      testID="hq-dashboard"
    >
      {/* 등장은 한 번 — 숫자 줄과 두 칸을 한 덩어리로 올린다. 섹션마다 따로 올리면 30ms 차이로 두 번 움직여
          "들어가는 애니메이션이 두 번 나온다"로 보였다(사용자 지적 2026-10-02). */}
      <Appear>
        <HqStrip
          testID="hq-kpi"
          items={[
            { label: '연결 매장', value: scope.length, unit: '곳', sub: relF !== 'all' && mixed ? `${relationLabel(relF)}만 · 전체 ${overview.length}곳` : stats.pendingInvites ? `초대 대기 ${stats.pendingInvites}건` : '초대 대기 없음' },
            { label: '배포한 노하우', value: deployedCount, unit: '건', sub: deployedCount ? '한 곳 이상에 내려간 노하우' : '노하우를 쓰고 [배포]를 누르면 세요' },
            { label: '배포한 퀴즈', value: deployedQuizzes, unit: '건', sub: deployedQuizzes ? '한 곳 이상에 내려간 퀴즈 · 발송은 매장이 정해요' : '퀴즈를 만들고 [배포]를 누르면 세요' },
            { label: '숙지율', value: stats.mastery === null ? null : `${stats.mastery}%`, sub: stats.mastery === null ? '배포한 노하우가 생기면 계산돼요' : `${scopeNote} 평균` },
          ]}
        />

        <View style={styles.cols}>
        <HqCard style={styles.attCol} testID="hq-attention">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>확인 필요</Text>
            <Text style={styles.cardMeta}>{attention.length ? `${attention.reduce((n, x) => n + x.v, 0)}건` : ''}</Text>
          </View>
          {attention.length === 0 ? (
            <View style={styles.attNone}><Text style={styles.attNoneText}>지금 확인할 일이 없어요.</Text></View>
          ) : (
            attention.map((a, i) => (
              <AttentionRow
                key={a.k}
                k={a.k}
                v={a.v}
                n={a.n}
                first={i === 0}
                onPress={() => (a.to === 'invites' ? router.push('/hq/stores/invites') : goStores())}
              />
            ))
          )}
        </HqCard>

        <View style={styles.tableCol}>
          <HqSlab title="매장 현황" hint="이름순 · 행을 누르면 매장 상세" more={{ label: '전체 매장', onPress: () => goStores() }} />
          <HqTable
            columns={[
              { key: 'name', label: '매장', width: 200, render: (r) => <Cell kind="name">{r.store_name}</Cell> },
              { key: 'vis', label: '공개 수준', width: 130, render: (r) => <HqPill tone={VIS_TONE[r.visibility]} label={visibilityLabel(r.visibility)} /> },
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
        </View>
        </View>
      </Appear>
    </HqPage>
  );
}

/** 확인 필요 한 줄 — 이름 · 설명 · 오른쪽 큰 숫자. 누르면 처리할 화면으로. */
function AttentionRow({ k, v, n, first, onPress }: { k: string; v: number; n: string; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${k} ${v}건`}
      style={({ pressed }) => [styles.attRow, !first && styles.attBorder, pressed && { backgroundColor: InkColors.paper }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cellK}>{k}</Text>
        <Text style={styles.cellN}>{n}</Text>
      </View>
      <Text style={styles.cellV}>{v}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  kpiScope: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kpiScopeLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  // 두 칸 — 왼쪽 확인 필요(고정 폭) · 오른쪽 매장 현황(남는 폭). 좁으면 아래로 접힌다.
  cols: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xl, flexWrap: 'wrap' },
  attCol: { width: 360, flexGrow: 0, flexShrink: 0 },
  tableCol: { flex: 1, minWidth: 520 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm, marginBottom: Space.sm },
  cardTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink, flexShrink: 0 },
  cardMeta: { fontSize: 13.5, color: InkColors.ink3 },
  attNone: { paddingVertical: Space.md },
  attNoneText: { fontSize: 14, color: InkColors.ink3 },
  attRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, minHeight: 56 },
  attBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  cellK: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink },
  cellV: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: InkColors.ink, fontVariant: ['tabular-nums'], flexShrink: 0 },
  cellN: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },
});
