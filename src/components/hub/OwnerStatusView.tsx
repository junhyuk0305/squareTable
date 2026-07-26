// 사장 허브 '현황' 탭 본문 — 대시보드 본체 4블록(기획 v2 §03).
//  1) 오늘 스냅샷: 매장별 근무중/예정 카운트(카운트까지만 — 명단은 매장 출퇴근 화면)
//  2) 확인 필요: 합류 신청·받은질문·검토할 제안·검증 필요 노하우(행 탭 = 해당 매장 화면)
//  3) 매장 비교 표: 손 필요 순 기본·헤더 탭 정렬(★이 블록만 multi 게이팅, 매장 1곳=단일 요약)
//  4) 이번달: 인건비 합계 + AI 사용(무료 캡 대비 표기)
// 원칙: 전부 매장 단위(개인별 지표 산출 금지) · 허브는 읽기·이동까지(실행 UI 없음).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { canUseMultistore, PLANS } from '@/lib/config/tiers';
import { PlanUpgradeNotice } from '@/components/PlanUpgradeNotice';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Href } from 'expo-router';

type SortKey = 'pending_q' | 'working' | 'uncovered' | 'labor_month';

/** 표 셀용 축약 금액 — 1만 미만은 그대로, 이상은 만 단위(표 폭 보호). */
const fmtWonShort = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n.toLocaleString());

export function OwnerStatusView() {
  const overview = useHubStore((s) => s.overview);
  const today = useHubStore((s) => s.today);
  const ownerLoaded = useHubStore((s) => s.ownerLoaded);
  const todayLoaded = useHubStore((s) => s.todayLoaded);
  const hydrateOwner = useHubStore((s) => s.hydrateOwner);
  const crossData = useCrossNotifStore((s) => s.data);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const plan = useSessionStore((s) => s.plan);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();
  // 현재 플랜의 월 AI 캡(무료 150 / 유료 매장당 1500). null 이면 캡 없음 = 분모를 그리지 않는다.
  const aiCap = PLANS[plan].aiMonthly;

  useEffect(() => {
    void hydrateOwner();
    void hydrateCross();
    void hydratePrefs();
  }, [hydrateOwner, hydrateCross, hydratePrefs]);

  const [sortKey, setSortKey] = useState<SortKey>('pending_q');

  const todayByUnit = useMemo(() => {
    const m: Record<string, { working_now: number; scheduled: number }> = {};
    for (const r of today) m[r.unit_id] = r;
    return m;
  }, [today]);

  const labelOf = (uid: string) =>
    prefFor(uid).nickname || overview.find((r) => r.unit_id === uid)?.store_name || '매장';
  const colorOf = (uid: string) => storeColor(uid, prefFor(uid).color);

  // 소유 매장 집합 = overview(owner_overview 소유검증)가 SSOT — 직원 수 판정 4중 복제 방지(실사 경고).
  const ownedIds = useMemo(() => new Set(overview.map((r) => r.unit_id)), [overview]);

  // ── 확인 필요 집계(합류·질문·제안·검증) — 각 항목의 이동 목적지는 "건수가 가장 많은 매장" ──
  const inbox = useMemo(() => {
    const joins = crossData
      .filter((d) => ownedIds.has(d.unitId))
      .flatMap((d) => d.pending.map((p) => ({ uid: d.unitId, name: p.name })));
    const maxUnit = (val: (r: (typeof overview)[number]) => number) =>
      overview.reduce<{ uid: string | null; n: number }>(
        (acc, r) => (val(r) > acc.n ? { uid: r.unit_id, n: val(r) } : acc),
        { uid: null, n: 0 },
      ).uid;
    return {
      joins,
      joinUnit: joins[0]?.uid ?? null,
      questions: overview.reduce((n, r) => n + r.pending_q, 0),
      questionUnit: maxUnit((r) => r.pending_q),
      suggestions: overview.reduce((n, r) => n + r.sugg_pending, 0),
      suggestionUnit: maxUnit((r) => r.sugg_pending),
      needsReview: overview.reduce((n, r) => n + r.needs_review, 0),
      needsReviewUnit: maxUnit((r) => r.needs_review),
    };
  }, [crossData, ownedIds, overview]);
  const inboxEmpty =
    inbox.joins.length === 0 && inbox.questions === 0 && inbox.suggestions === 0 && inbox.needsReview === 0;

  // ── 매장 비교 정렬(손 필요 순 기본) — 정렬은 표 전용, 스냅샷·이번달은 매장 생성순 유지 ──
  const sorted = useMemo(() => {
    const val = (uid: string): number => {
      const r = overview.find((x) => x.unit_id === uid);
      if (!r) return 0;
      if (sortKey === 'working') return todayByUnit[uid]?.working_now ?? 0;
      return r[sortKey];
    };
    return [...overview].sort((a, b) => val(b.unit_id) - val(a.unit_id));
  }, [overview, sortKey, todayByUnit]);

  const laborTotal = overview.reduce((n, r) => n + r.labor_month, 0);
  const aiTotal = overview.reduce((n, r) => n + r.ai_used, 0);
  const workingTotal = today.reduce((n, r) => n + r.working_now, 0);
  const scheduledTotal = today.reduce((n, r) => n + r.scheduled, 0);
  const multi = overview.length > 1;

  if (!ownerLoaded && overview.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={InkColors.ink3} />
      </View>
    );
  }

  const inboxRow = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    count: number,
    uid: string | null,
    path: Href,
    sub?: string,
  ) => {
    if (count === 0) return null;
    return (
      <Pressable
        key={title}
        onPress={() => uid && goStore(uid, path)}
        disabled={!!switching}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={15} color={InkColors.ink2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
          {!!sub && <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>}
        </View>
        <Text style={styles.cnt}>{count}</Text>
        <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
      </Pressable>
    );
  };

  return (
    <View style={{ gap: Space.md }}>
      {/* ── 1) 오늘 스냅샷 ── */}
      <Appear delay={40}>
        <SectionLabel title="오늘" />
        <View style={styles.card}>
          <View style={styles.statRow}>
            {/* 부분 실패 시 "0명"으로 위장하지 않는다 — todayLoaded 전엔 '—' (빈화면 위장 금지). */}
            <View style={styles.statCell}>
              <Text style={styles.statV}>{todayLoaded ? workingTotal : '—'}{todayLoaded && <Text style={styles.statUnit}>명</Text>}</Text>
              <Text style={styles.statL}>지금 근무중</Text>
            </View>
            <View style={[styles.statCell, styles.statDivider]}>
              <Text style={styles.statV}>{todayLoaded ? scheduledTotal : '—'}{todayLoaded && <Text style={styles.statUnit}>명</Text>}</Text>
              <Text style={styles.statL}>오늘 근무 예정</Text>
            </View>
          </View>
          {overview.map((r) => {
            const t = todayByUnit[r.unit_id];
            return (
              <Pressable
                key={r.unit_id}
                // 명단은 직원 관리(로스터 상태칩: 근무중/퇴근)가 담당 — 허브는 카운트+이동까지.
                onPress={() => goStore(r.unit_id, '/owner/staff')}
                disabled={!!switching}
                style={({ pressed }) => [styles.row, styles.rowTop, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                <Text style={[styles.rowSub, (t?.working_now ?? 0) > 0 && styles.onair]}>
                  {!todayLoaded
                    ? '확인 중'
                    : `${(t?.working_now ?? 0) > 0 ? `${t!.working_now}명 근무중` : '출근 전'} · 예정 ${t?.scheduled ?? 0}`}
                </Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </Pressable>
            );
          })}
        </View>
      </Appear>

      {/* ── 2) 확인 필요 ── */}
      <Appear delay={80}>
        <SectionLabel title="확인 필요" />
        <View style={styles.card}>
          {inboxEmpty ? (
            <Text style={styles.emptyText}>지금 확인할 일이 없어요</Text>
          ) : (
            <>
              {inboxRow(
                'person-add-outline',
                '합류 신청',
                inbox.joins.length,
                inbox.joinUnit,
                '/owner/staff',
                inbox.joins[0] ? `${labelOf(inbox.joins[0].uid)} · ${inbox.joins[0].name}님` : undefined,
              )}
              {inboxRow('chatbubble-outline', '받은질문', inbox.questions, inbox.questionUnit, '/owner/inbox')}
              {inboxRow('bulb-outline', '검토할 제안', inbox.suggestions, inbox.suggestionUnit, '/owner/suggestions')}
              {inboxRow('search-outline', '검증이 필요한 노하우', inbox.needsReview, inbox.needsReviewUnit, '/owner/categories')}
            </>
          )}
        </View>
      </Appear>

      {/* ── 3) 매장 비교(다점포) / 단일 매장 요약 ── */}
      {multi && (
        <Appear delay={120}>
          <SectionLabel title="매장 비교" hint="항목을 누르면 정렬" />
          {canUseMultistore(plan) ? (
            <View style={styles.card}>
              <View style={styles.thRow}>
                <Text style={[styles.th, styles.thName]}>매장</Text>
                <SortTh label="질문" k="pending_q" cur={sortKey} onPress={setSortKey} />
                <SortTh label="근무" k="working" cur={sortKey} onPress={setSortKey} />
                <SortTh label="미첨부" k="uncovered" cur={sortKey} onPress={setSortKey} />
                <SortTh label="인건비" k="labor_month" cur={sortKey} onPress={setSortKey} />
              </View>
              {sorted.map((r) => {
                const t = todayByUnit[r.unit_id];
                return (
                  <Pressable
                    key={r.unit_id}
                    onPress={() => goStore(r.unit_id, '/owner/dashboard', 'replace')}
                    disabled={!!switching}
                    style={({ pressed }) => [styles.tdRow, pressed && { opacity: 0.85 }]}
                  >
                    <View style={[styles.tdName, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                      <Text style={styles.tdNameText} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                    </View>
                    <Text style={[styles.td, r.pending_q > 0 && styles.tdHot]}>{r.pending_q}</Text>
                    <Text style={styles.td}>{todayLoaded ? `${t?.working_now ?? 0}/${t?.scheduled ?? 0}` : '—'}</Text>
                    <Text style={styles.td}>{r.uncovered}</Text>
                    <Text style={styles.td}>{fmtWonShort(r.labor_month)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <PlanUpgradeNotice description="전체 매장을 지표로 비교하는 표는 다점포 요금제 기능이에요." />
          )}
        </Appear>
      )}

      {/* ── 4) 이번달 ── */}
      <Appear delay={multi ? 160 : 120}>
        <SectionLabel title="이번달" />
        <View style={styles.card}>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <Text style={styles.statV}>{laborTotal.toLocaleString()}<Text style={styles.statUnit}>원</Text></Text>
              <Text style={styles.statL}>인건비 합계</Text>
            </View>
            <View style={[styles.statCell, styles.statDivider]}>
              <Text style={styles.statV}>
                {aiTotal.toLocaleString()}
                {/* 0082 부터 유료 플랜에도 캡(매장당 1500)이 있다 — free 만 분모를 보여주면
                    유료 사장은 자기 한도를 모른 채 402를 맞는다. 현재 플랜의 캡을 그대로 쓴다. */}
                {aiCap != null && <Text style={styles.statUnit}> / {aiCap.toLocaleString()}</Text>}
              </Text>
              <Text style={styles.statL}>AI 답변 사용</Text>
            </View>
          </View>
          {multi &&
            overview.map((r) => (
              <View key={r.unit_id} style={[styles.row, styles.rowTop]}>
                <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                <Text style={styles.rowSub}>{`${r.labor_month.toLocaleString()}원 · AI ${r.ai_used}건`}</Text>
              </View>
            ))}
          {aiCap != null && (
            <Text style={styles.caption}>
              {plan === 'free'
                ? `무료 요금제는 매장당 월 ${aiCap.toLocaleString()}건까지예요`
                : `매장당 월 ${aiCap.toLocaleString()}건까지 쓸 수 있어요`}
            </Text>
          )}
        </View>
      </Appear>
    </View>
  );
}

function SortTh({ label, k, cur, onPress }: { label: string; k: SortKey; cur: SortKey; onPress: (k: SortKey) => void }) {
  const on = cur === k;
  return (
    <Pressable onPress={() => onPress(k)} hitSlop={6} style={styles.thCell}>
      <Text style={[styles.th, on && styles.thOn]}>{label}{on ? ' ↓' : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Space.xl * 2, alignItems: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    marginTop: Space.sm,
    ...Elevation.e2,
  },
  statRow: { flexDirection: 'row', paddingVertical: Space.xs },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  statV: { fontSize: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  statUnit: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  statL: { fontSize: 11.5, color: InkColors.ink3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2 },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowIcon: {
    width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  rowSub: { fontSize: 12, color: InkColors.ink3 },
  onair: { color: BrandColors.good, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cnt: {
    minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: '900', color: '#8a5a12',
    backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: Space.xs + 2, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },
  emptyText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', paddingVertical: Space.sm },
  caption: { fontSize: 11.5, color: InkColors.ink3, marginTop: Space.sm, textAlign: 'center' },

  // 비교 표 — 이름 열 flex, 수치 열 고정폭 우측 정렬(웹·네이티브 공통 문법)
  thRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: Space.xs, gap: 2 },
  thCell: { width: 52, alignItems: 'flex-end' },
  th: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  thOn: { color: InkColors.ink },
  thName: { flex: 1 },
  tdRow: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderTopWidth: 1, borderTopColor: InkColors.line, paddingVertical: Space.sm + 2,
  },
  tdName: { flex: 1, minWidth: 0 },
  tdNameText: { fontSize: 13, fontWeight: '700', color: InkColors.ink, flexShrink: 1 },
  td: { width: 52, textAlign: 'right', fontSize: 12.5, fontWeight: '600', color: InkColors.ink2 },
  tdHot: { color: '#8a5a12', fontWeight: '900' },
});
