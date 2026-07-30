// 사장 허브 '노하우' 탭 본문 — 지식 신선도(슬라이스 D, 3탭 확장의 두 번째 탭).
//
// 무엇: "매장 지식이 지금도 맞는가"를 매장 단위로 보여준다(O4·O5 — 격자·bus factor 없이).
//   · 노하우로 만들 것 = 미답변 질문(pending_q) — 답 하나가 노하우 하나가 되는 입구
//   · 검증이 필요한 노하우(needs_review) — 시드·제안 반영분의 확인 대기
//   · 오래 손 안 댄 노하우(stale, 90일+) — 메뉴·가격이 변했는데 노하우만 옛날일 위험
// 원칙: 허브는 읽기·이동까지(실행은 매장 화면) · 매장 단위만 · 0은 위험이 아니라 좋은 소식
//   ("지금은 손볼 노하우가 없어요") · 노하우 0인 매장은 행동 버튼(노하우 담기)이 먼저.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { StorePickerSheet } from '@/components/hub/StorePickerSheet';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Href } from 'expo-router';

export function OwnerKnowhowHubView() {
  const overview = useHubStore((s) => s.overview);
  const ownerLoaded = useHubStore((s) => s.ownerLoaded);
  const hydrateOwner = useHubStore((s) => s.hydrateOwner);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();

  useEffect(() => {
    void hydrateOwner();
    void hydratePrefs();
  }, [hydrateOwner, hydratePrefs]);

  const labelOf = (uid: string) =>
    prefFor(uid).nickname || overview.find((r) => r.unit_id === uid)?.store_name || '매장';
  const colorOf = (uid: string) => storeColor(uid, prefFor(uid).color);

  const totals = useMemo(
    () =>
      overview.reduce(
        (a, r) => ({
          pending: a.pending + r.pending_q,
          review: a.review + r.needs_review,
          stale: a.stale + r.stale,
          knowhow: a.knowhow + r.knowhow,
        }),
        { pending: 0, review: 0, stale: 0, knowhow: 0 },
      ),
    [overview],
  );
  const emptyStores = useMemo(() => overview.filter((r) => r.knowhow === 0), [overview]);
  const allClear = totals.pending === 0 && totals.review === 0 && totals.stale === 0;

  // 노하우 담기 — 템플릿 구경은 매장 무관이지만 "담기"는 매장에 종속되므로,
  // 다점포면 어느 매장에 담을지 먼저 고르게 한다(매장 1곳이면 시트 없이 바로 이동).
  const [pickOpen, setPickOpen] = useState(false);
  const startTemplates = (uid: string) => {
    if (overview.length > 1) setPickOpen(true);
    else void goStore(uid, '/owner/templates');
  };

  if (!ownerLoaded && overview.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={InkColors.ink3} />
      </View>
    );
  }

  // 매장별 카운트 행(0인 매장은 숨김 — 리스트 소음 방지). 탭 = 그 매장의 해당 화면으로 이동.
  const storeRows = (val: (r: (typeof overview)[number]) => number, path: Href) =>
    overview
      .filter((r) => val(r) > 0)
      .map((r) => (
        <Pressable
          key={r.unit_id}
          onPress={() => goStore(r.unit_id, path)}
          disabled={!!switching}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
        >
          <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
          <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
          <Text style={styles.cnt}>{val(r)}</Text>
          <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
        </Pressable>
      ));

  return (
    <View style={{ gap: Space.md }}>
      {/* ── 노하우 0 매장 = 담기가 먼저(빈 화면 행동 버튼) ── */}
      {emptyStores.map((r) => (
        <Appear key={r.unit_id} delay={0}>
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>{labelOf(r.unit_id)}에 아직 노하우가 없어요</Text>
            <Text style={styles.emptyBody}>업종 추천 노하우를 담으면 직원이 물을 때 AI가 대신 답해요.</Text>
            <Pressable
              onPress={() => startTemplates(r.unit_id)}
              disabled={!!switching}
              style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel="노하우 담기"
            >
              <Ionicons name="add-circle-outline" size={15} color={InkColors.ink} />
              <Text style={styles.emptyBtnText}>노하우 담기</Text>
            </Pressable>
          </View>
        </Appear>
      ))}

      {/* ── 노하우로 만들 것(미답변 질문) ── */}
      <Appear delay={40}>
        <SectionLabel title="노하우로 만들 것" hint="답 하나가 노하우 하나가 돼요" />
        <View style={styles.card}>
          {totals.pending === 0 ? (
            <Text style={styles.clearText}>기다리는 질문이 없어요</Text>
          ) : (
            storeRows((r) => r.pending_q, '/owner/inbox')
          )}
        </View>
      </Appear>

      {/* ── 검증이 필요한 노하우 ── */}
      <Appear delay={80}>
        <SectionLabel title="검증이 필요한 노하우" />
        <View style={styles.card}>
          {totals.review === 0 ? (
            <Text style={styles.clearText}>확인을 기다리는 노하우가 없어요</Text>
          ) : (
            storeRows((r) => r.needs_review, '/owner/categories')
          )}
        </View>
      </Appear>

      {/* ── 오래 손 안 댄 노하우(90일+) ── */}
      <Appear delay={120}>
        <SectionLabel title="오래 손 안 댄 노하우" hint="90일 넘게 수정 없음" />
        <View style={styles.card}>
          {totals.stale === 0 ? (
            <Text style={styles.clearText}>
              {totals.knowhow === 0 ? '노하우가 쌓이면 여기서 신선도를 챙겨드려요' : '전부 최근에 손봤어요'}
            </Text>
          ) : (
            <>
              <Text style={styles.staleHint}>메뉴·가격이 바뀌었는데 노하우만 옛날일 수 있어요. 한 번 훑어봐 주세요.</Text>
              {storeRows((r) => r.stale, '/owner/categories')}
            </>
          )}
        </View>
      </Appear>

      {allClear && totals.knowhow > 0 && (
        <Appear delay={160}>
          <Text style={styles.allClearText}>지금은 손볼 노하우가 없어요</Text>
        </Appear>
      )}

      <StorePickerSheet
        visible={pickOpen}
        title="노하우 담기"
        hint="어느 매장에 담을지 골라 주세요"
        rows={overview.map((r) => ({ uid: r.unit_id, label: labelOf(r.unit_id), color: colorOf(r.unit_id) }))}
        onPick={(uid) => {
          setPickOpen(false);
          void goStore(uid, '/owner/templates');
        }}
        onClose={() => setPickOpen(false)}
      />
    </View>
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

  emptyTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink, paddingTop: Space.xs },
  emptyBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, marginTop: 2 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: BrandColors.yellowSoft,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    marginTop: Space.md,
    marginBottom: Space.xs,
  },
  emptyBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },

  clearText: { fontSize: 15, color: InkColors.ink3, textAlign: 'center', paddingVertical: Space.sm },
  staleHint: { fontSize: 12.5, color: InkColors.ink3, lineHeight: 18, paddingVertical: Space.xs },
  allClearText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  cnt: {
    minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: '900', color: '#8a5a12',
    backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: Space.xs + 2, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
