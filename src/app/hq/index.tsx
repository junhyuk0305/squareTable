// /hq — 대시보드(정본 §5-2): KPI 스트립 → 확인 필요 → 매장 표 요약. 교차표(매장 × 노하우 숙지)는 P4.
//
// 재료 = useBrandStore(brand_overview · brand_invites_list). 숫자는 전부 매장 단위 — 개인 축 0, 랭킹 0.
import { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { HqPage, HqButton, HqPill, HqSlab, HqNotice } from '@/components/hq/HqKit';
import { HqStrip } from '@/components/hq/HqStrip';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { visibilityLabel, payerLabel } from '@/lib/brand/visibility';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

export default function HqDashboardScreen() {
  const router = useRouter();
  const brand = useBrandStore((s) => s.brand);
  const overview = useBrandStore((s) => s.overview);
  const invites = useBrandStore((s) => s.invites);
  const loaded = useBrandStore((s) => s.loaded);
  const error = useBrandStore((s) => s.error);
  const hydrate = useBrandStore((s) => s.hydrate);
  const refresh = useBrandStore((s) => s.refresh);
  useFocusEffect(useCallback(() => { void hydrate(); }, [hydrate]));

  const stats = useMemo(() => {
    const pendingInvites = invites.filter((i) => i.kind === 'store' && i.status === 'pending').length;
    const expiredInvites = invites.filter((i) => i.kind === 'store' && i.status === 'expired').length;
    const visRequests = overview.filter((r) => r.visibility_requested).length;
    const payerToAnswer = overview.filter((r) => r.payer_proposed && !r.payer_proposed_by_brand).length;
    const payerWaiting = overview.filter((r) => r.payer_proposed && r.payer_proposed_by_brand).length;
    const pendingQ = overview.reduce((a, r) => a + r.pending_q, 0);
    const aiUsed = overview.reduce((a, r) => a + r.ai_used, 0);
    // 숙지율: 재료가 있는 매장만 평균. P4 사본 전엔 전부 null → null.
    const withMastery = overview.filter((r) => r.mastery !== null);
    const mastery = withMastery.length ? Math.round((withMastery.reduce((a, r) => a + (r.mastery ?? 0), 0) / withMastery.length) * 100) : null;
    return { pendingInvites, expiredInvites, visRequests, payerToAnswer, payerWaiting, pendingQ, aiUsed, mastery };
  }, [overview, invites]);

  const goStores = (unit?: string) => router.push(unit ? { pathname: '/hq/stores', params: { unit } } : '/hq/stores');

  return (
    <HqPage
      title="대시보드"
      sub={brand ? `${brand.brand_name} · 연결 매장 ${overview.length}곳의 매장 단위 요약이에요. 매장 순위·등급·종합 점수는 만들지 않아요.` : loaded ? '' : '불러오는 중…'}
      actions={<HqButton label="새로고침" icon="refresh-outline" onPress={() => void refresh()} />}
      testID="hq-dashboard"
    >
      {error ? <HqNotice tone="warn">현황을 불러오지 못했어요. 새로고침을 눌러 다시 시도해 주세요. ({error})</HqNotice> : null}

      <HqStrip
        testID="hq-kpi"
        items={[
          { label: '연결 매장', value: overview.length, unit: '곳', sub: stats.pendingInvites ? `초대 대기 ${stats.pendingInvites}건` : '초대 대기 없음' },
          { label: '배포한 노하우', value: 0, unit: '건', sub: '노하우 배포는 다음 단계에서 열려요' },
          { label: '숙지율', value: stats.mastery === null ? null : `${stats.mastery}%`, sub: stats.mastery === null ? '배포한 노하우가 생기면 계산돼요' : '연결 매장 평균' },
          { label: '미해결 질문', value: stats.pendingQ, unit: '건', sub: '연결 매장 합계 · 건수만' },
          { label: '이번 달 AI 사용', value: stats.aiUsed, unit: '건', sub: '연결 매장 합계' },
        ]}
      />

      <HqSlab title="확인 필요" hint="본사가 처리할 수 있는 것만 올려요" />
      <View style={styles.cellcard} testID="hq-attention">
        <AttentionCell k="연결 동의 대기" v={stats.pendingInvites} n="점주가 앱에서 수락하면 표에 올라와요" onPress={() => goStores()} />
        <AttentionCell k="공개 수준 요청 중" v={stats.visRequests} n="점주가 답을 보고 있어요" onPress={() => goStores()} />
        <AttentionCell k="답할 요금 부담 제안" v={stats.payerToAnswer} n={stats.payerWaiting ? `보낸 제안 ${stats.payerWaiting}건은 점주 대기` : '점주가 보낸 제안'} onPress={() => goStores()} />
        <AttentionCell k="만료된 초대" v={stats.expiredInvites} n="14일이 지났어요. 다시 보낼 수 있어요" onPress={() => goStores()} />
      </View>

      <HqSlab title="매장" hint="이름순 · 행을 누르면 매장 화면에서 연결 정보가 열려요" more={{ label: '전체 보기', onPress: () => goStores() }} />
      <HqTable
        columns={[
          { key: 'name', label: '매장', width: 220, render: (r) => <Cell kind="name">{r.store_name}</Cell> },
          { key: 'payer', label: '요금 부담', width: 110, render: (r) => <HqPill tone={r.payer === 'brand' ? 'y' : 'n'} label={payerLabel(r.payer)} /> },
          { key: 'vis', label: '공개 수준', width: 130, render: (r) => <HqPill tone={r.visibility === 'ops' ? 'g' : r.visibility === 'knowhow' ? 'i' : 'n'} label={visibilityLabel(r.visibility)} /> },
          { key: 'staff', label: '직원', align: 'right', render: (r) => <Cell kind="num">{r.staff}</Cell>, sortValue: (r) => r.staff },
          { key: 'pq', label: '미해결 질문', align: 'right', render: (r) => <Cell kind="num">{r.pending_q}</Cell>, sortValue: (r) => r.pending_q },
          { key: 'ai', label: 'AI 사용(월)', align: 'right', render: (r) => <Cell kind="num">{r.ai_used}</Cell>, sortValue: (r) => r.ai_used },
        ]}
        rows={overview}
        rowKey={(r) => r.unit_id}
        onRowPress={(r) => goStores(r.unit_id)}
        footer={loaded ? `${overview.length}곳` : undefined}
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
  cellcard: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, overflow: 'hidden', marginBottom: 22, backgroundColor: InkColors.bg, ...Elevation.e1 },
  cell: { flex: 1, minWidth: 180, paddingVertical: 16, paddingHorizontal: 18, borderLeftWidth: 1, borderLeftColor: InkColors.line, marginLeft: -1 },
  cellK: { fontSize: 14, fontWeight: '600', color: InkColors.ink2, marginBottom: 6 },
  cellV: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: InkColors.ink },
  cellZero: { fontSize: 17, fontWeight: '700', color: InkColors.ink3 },
  cellN: { fontSize: 13, color: InkColors.ink3, marginTop: 4 },
});
