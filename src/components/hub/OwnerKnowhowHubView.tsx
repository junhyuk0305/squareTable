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
import { StorePickerSheet, type StorePickerRow } from '@/components/hub/StorePickerSheet';
import { SectionLabel } from '@/components/SectionLabel';
import { MiniStats } from '@/components/blocks/MiniStats';
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

  // 매장 선택 시트 공용 — "어느 매장에/에서"가 먼저인 모든 흐름이 쓴다.
  // 2026-08-06: templates·import 두 상수였던 것을 범용 형태로 바꿨다. 챙길 것 3지표(MiniStats)도
  // 다점포에서는 같은 시트로 매장을 고르게 하고, **매장별 건수는 시트의 배지가 보여준다** —
  // 옛 판본은 그 분해를 위해 섹션 카드를 3장 세워서 '제목 → 카드' 반복을 만들고 있었다.
  type Picker = { title: string; hint: string; path: Href; rows: StorePickerRow[] };
  const [picker, setPicker] = useState<Picker | null>(null);
  const allRows = (): StorePickerRow[] =>
    overview.map((r) => ({ uid: r.unit_id, label: labelOf(r.unit_id), color: colorOf(r.unit_id) }));
  const startTemplates = (uid: string) => {
    if (overview.length > 1) {
      setPicker({ title: '노하우 담기', hint: '어느 매장에 담을지 골라 주세요', path: '/owner/templates', rows: allRows() });
    } else void goStore(uid, '/owner/templates');
  };

  /** 챙길 것 한 칸을 눌렀을 때 — 다점포면 매장 선택(건수 배지 포함), 단일이면 바로 이동. */
  const jump = (title: string, val: (r: (typeof overview)[number]) => number, path: Href) => () => {
    const hits = overview.filter((r) => val(r) > 0);
    if (overview.length > 1) {
      setPicker({
        title,
        hint: '확인할 매장을 골라 주세요',
        path,
        // 0건 매장은 배지를 그리지 않는다(배지 없음 = 없음) — StatusView와 같은 규칙.
        rows: overview.map((r) => ({ uid: r.unit_id, label: labelOf(r.unit_id), color: colorOf(r.unit_id), count: val(r) > 0 ? val(r) : undefined })),
      });
    } else if (hits[0]) void goStore(hits[0].unit_id, path);
    else if (overview[0]) void goStore(overview[0].unit_id, path);
  };

  if (!ownerLoaded && overview.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={InkColors.ink3} />
      </View>
    );
  }

  // (2026-08-06) 매장별 카운트 행 storeRows는 제거했다 — 세 섹션 카드가 사라지면서 소비자가 없어졌고,
  // 매장별 분해는 이제 매장 선택 시트의 count 배지가 맡는다.

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

      {/* ── 매장별 노하우 — 각 매장의 노하우 화면으로 가는 관리 입구 + 매장 간 가져오기 ── */}
      {(overview.some((r) => r.knowhow > 0) || overview.length > 1) && (
        <Appear delay={20}>
          <SectionLabel title="매장별 노하우" />
          <View style={styles.card}>
            {overview
              .filter((r) => r.knowhow > 0)
              .map((r) => (
                <Pressable
                  key={r.unit_id}
                  onPress={() => goStore(r.unit_id, '/owner/knowledge')}
                  disabled={!!switching}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${labelOf(r.unit_id)} 노하우 ${r.knowhow}개 관리`}
                >
                  <View style={[styles.dot, { backgroundColor: colorOf(r.unit_id) }]} />
                  <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id)}</Text>
                  <Text style={styles.cntNeutral}>{r.knowhow}</Text>
                  <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                </Pressable>
              ))}
            {overview.length > 1 && (
              <Pressable
                onPress={() => setPicker({ title: '다른 매장에서 가져오기', hint: '어느 매장으로 가져올지 골라 주세요', path: '/owner/import-knowhow', rows: allRows() })}
                disabled={!!switching}
                style={({ pressed }) => [styles.row, styles.importRow, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="다른 매장에서 노하우 가져오기"
              >
                <Ionicons name="swap-horizontal" size={15} color={InkColors.ink2} />
                <Text style={styles.importText}>다른 매장에서 가져오기</Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </Pressable>
            )}
          </View>
        </Appear>
      )}

      {/* ── 챙길 것(블록 I3) — 세 지표를 한 줄로.
             2026-08-06: '노하우로 만들 것 / 검증이 필요한 / 오래 손 안 댄'이 각각 제목+카드였다.
             셋 다 "N건 남았다" 하나만 말하는데 카드를 3장 세우니 이 화면이 카드 나열이 됐다.
             숫자는 MiniStats 한 줄로 내리고, 매장별 분해는 탭했을 때 매장 선택 시트의 배지가 맡는다
             (StatusView가 이미 쓰는 패턴). 섹션 힌트는 각 칸의 ⓘ로 옮겼다. ── */}
      <Appear delay={40}>
        <SectionLabel title="챙길 것" />
        <MiniStats
          items={[
            {
              key: 'pending',
              value: totals.pending,
              label: '노하우로 만들 것',
              onPress: jump('노하우로 만들 것', (r) => r.pending_q, '/owner/inbox'),
              info: {
                title: "'노하우로 만들 것'이 뭐예요?",
                body: '노하우에 없어서 사장님 답을 기다리는 질문이에요.\n답 하나가 노하우 하나가 돼요.',
              },
            },
            {
              key: 'review',
              value: totals.review,
              label: '검증 필요',
              onPress: jump('검증이 필요한 노하우', (r) => r.needs_review, '/owner/categories'),
              info: {
                title: "'검증 필요'가 뭐예요?",
                body: '업종 추천이나 직원 제안으로 들어온 노하우 중, 아직 우리 매장 기준이 맞는지 확인하지 않은 것이에요.',
              },
            },
            {
              key: 'stale',
              value: totals.stale,
              label: '오래 손 안 댐',
              onPress: jump('오래 손 안 댄 노하우', (r) => r.stale, '/owner/categories'),
              info: {
                title: "'오래 손 안 댐'이 뭐예요?",
                body: '90일 넘게 수정이 없는 노하우예요.\n메뉴·가격이 바뀌었는데 노하우만 옛날일 수 있어요. 한 번 훑어봐 주세요.',
              },
            },
          ]}
        />
      </Appear>

      {allClear && totals.knowhow > 0 && (
        <Appear delay={160}>
          <Text style={styles.allClearText}>지금은 손볼 노하우가 없어요</Text>
        </Appear>
      )}

      <StorePickerSheet
        visible={picker !== null}
        title={picker?.title ?? ''}
        hint={picker?.hint ?? ''}
        rows={picker?.rows ?? []}
        onPick={(uid) => {
          const path = picker?.path;
          setPicker(null);
          if (path) void goStore(uid, path);
        }}
        onClose={() => setPicker(null)}
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

  allClearText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  // 매장별 노하우 개수 — 경고가 아닌 중립 정보라 warn 배지 대신 무채색.
  cntNeutral: {
    minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: '900', color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.xs + 2, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },
  importRow: { borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: Space.xs },
  importText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink2, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
