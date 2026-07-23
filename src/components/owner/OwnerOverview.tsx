import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchOwnerOverview, type OwnerOverviewRow } from '@/lib/db';
import { showToast } from '@/lib/store/useToastStore';
import { SectionLabel } from '@/components/SectionLabel';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const won = (n: number) => '₩' + Math.round(n || 0).toLocaleString('ko-KR');

function Cell({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={styles.cell}>
      <Text style={[styles.cellVal, alert && styles.cellValAlert]}>{value}</Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
}

/**
 * OwnerOverview — 다점포 통합뷰(크롬리스). 내 전 매장의 미답질문·직원·노하우·이번달 인건비를
 * 합계 + 매장별 카드로 한 번에. 매장 카드 탭 → switchUnit → 그 매장 홈으로 이동.
 * (활성 매장만 보이는 RLS를 우회하는 owner_overview definer RPC 로 소유 매장만 집계.)
 * SafeArea/헤더/탭바는 상위 owner/overview 가 소유.
 */
export function OwnerOverview() {
  const router = useRouter();
  const activeUnit = useSessionStore((s) => s.unitId);
  const switchUnit = useSessionStore((s) => s.switchUnit);

  const [rows, setRows] = useState<OwnerOverviewRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    // 동기 setState를 이펙트에 두지 않는다(cascading render 방지) — 로딩/에러 리셋은 초기값·재시도 핸들러가,
    // 실제 상태 전이는 async 콜백에서만.
    let alive = true;
    fetchOwnerOverview().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(true); setRows(null); } else setRows(data ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [nonce]);

  const totals = useMemo(() => {
    const r = rows ?? [];
    const sum = (k: keyof OwnerOverviewRow) => r.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    return { pending_q: sum('pending_q'), knowhow: sum('knowhow'), staff: sum('staff'), labor_month: sum('labor_month') };
  }, [rows]);

  // "손 필요 순" — 미답 질문 많은 매장부터, 다음은 노하우 미첨부 업무 많은 순(둘 다 매장 단위 결과물 신호).
  // 서버는 생성순으로 주고, 사장이 볼 것(손 필요)을 먼저 보이도록 클라에서만 파생 정렬(서버 무변경).
  const sorted = useMemo(() => {
    return [...(rows ?? [])].sort((a, b) =>
      (b.pending_q - a.pending_q) || ((b.uncovered ?? 0) - (a.uncovered ?? 0)) || a.store_name.localeCompare(b.store_name, 'ko'),
    );
  }, [rows]);

  const goStore = async (unitId: string) => {
    if (busyId) return;
    if (unitId === activeUnit) { router.replace('/owner/dashboard'); return; }
    setBusyId(unitId);
    const { error } = await switchUnit(unitId);
    setBusyId(null);
    if (error) { showToast(error, 'warn'); return; }
    router.replace('/owner/dashboard'); // 전환한 매장 홈으로(레이아웃이 unitId 변경으로 전 스토어 재hydrate)
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={InkColors.ink3} /></View>;
  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>불러오지 못했어요.</Text>
        <Pressable onPress={() => { setErr(false); setLoading(true); setNonce((n) => n + 1); }} hitSlop={8}><Text style={styles.retry}>다시 시도</Text></Pressable>
      </View>
    );
  }
  if (!rows || rows.length === 0) {
    return <View style={styles.center}><Text style={styles.emoji}>🏪</Text><Text style={styles.dim}>표시할 매장이 없어요.</Text></View>;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* 합계 */}
      <View style={styles.block}>
        <SectionLabel icon="albums-outline" title={`전체 ${rows.length}개 매장 합계`} />
        <View style={styles.totalCard}>
          <View style={styles.totRow}>
            <Cell label="미답 질문" value={String(totals.pending_q)} alert={totals.pending_q > 0} />
            <Cell label="직원" value={String(totals.staff)} />
            <Cell label="노하우" value={String(totals.knowhow)} />
          </View>
          <View style={styles.laborRow}>
            <Text style={styles.laborLabel}>이번 달 인건비 합계</Text>
            <Text style={styles.laborVal}>{won(totals.labor_month)}</Text>
          </View>
        </View>
      </View>

      {/* 매장별 */}
      <View style={styles.block}>
        <SectionLabel icon="storefront-outline" title="매장별" hint="손 필요 순 · 탭하면 그 매장으로" />
        <View style={styles.list}>
          {sorted.map((r) => (
            <Pressable
              key={r.unit_id}
              onPress={() => goStore(r.unit_id)}
              style={({ pressed }) => [styles.card, r.is_active && styles.cardActive, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel={`${r.store_name}${r.is_active ? ' 현재 매장' : '로 이동'}`}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardName} numberOfLines={1}>{r.store_name}</Text>
                {r.is_active ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>현재</Text></View>
                ) : null}
                <View style={{ flex: 1 }} />
                {busyId === r.unit_id ? (
                  <ActivityIndicator size="small" color={InkColors.ink} />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
                )}
              </View>
              <View style={styles.metrics}>
                <Cell label="미답" value={String(r.pending_q)} alert={r.pending_q > 0} />
                <Cell label="직원" value={String(r.staff)} />
                <Cell label="노하우" value={String(r.knowhow)} />
                <Cell label="미첨부 업무" value={String(r.uncovered ?? 0)} />
              </View>
              <View style={styles.laborRowSm}>
                <Text style={styles.laborLabelSm}>이번 달 인건비</Text>
                <Text style={styles.laborValSm}>{won(r.labor_month)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: Space.xl },
  dim: { fontSize: 14, color: InkColors.ink3, fontWeight: '600' },
  emoji: { fontSize: 32 },
  retry: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, textDecorationLine: 'underline', marginTop: 4 },

  block: { gap: Space.sm },

  // 합계 카드
  totalCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, gap: Space.md, ...Elevation.e2,
  },
  totRow: { flexDirection: 'row', gap: Space.sm },
  laborRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: InkColors.paper, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingVertical: 11, paddingHorizontal: 13,
  },
  laborLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  laborVal: { fontSize: 17, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3 },

  // 매장 카드
  list: { gap: Space.sm },
  card: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.md, gap: Space.sm, ...Elevation.e1,
  },
  cardActive: { borderColor: InkColors.ink, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardName: { fontSize: 15, fontWeight: '800', color: InkColors.ink, flexShrink: 1 },
  badge: { backgroundColor: InkColors.ink, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10.5, fontWeight: '800', color: InkColors.bubbleText },
  metrics: { flexDirection: 'row', gap: Space.sm },

  cell: {
    flex: 1, backgroundColor: InkColors.paper, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingVertical: 10, alignItems: 'center',
  },
  cellVal: { fontSize: 18, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3, lineHeight: 20 },
  cellValAlert: { color: BrandColors.bad },
  cellLabel: { fontSize: 11, fontWeight: '600', color: InkColors.ink3, marginTop: 3 },

  laborRowSm: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  laborLabelSm: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },
  laborValSm: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
});
