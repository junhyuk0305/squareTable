// 직원 허브 '성장' 탭 본문 — 축적 레이어(슬라이스 C, 3탭 확장의 두 번째 탭).
//
// 무엇: "내가 남긴 것"의 축적을 본인에게 되돌려준다(순환 보상 단계 — M1 채택).
//   · 가르침 실적(내 답이 노하우로 채택) — 최고 역량 = "가르칠 수 있음"(실적, 도장 아님)
//   · 내 노하우·최근 30일 참조 수(query_hits — 살아있는 카운트)
//   · 해본 업무 종류 수 — ★완료≠숙련: "해봤다"(경험)까지만 말하고 숙련을 주장하지 않는다
// 원칙: 전부 본인 전용(my_growth RPC 내부 강제·사장 화면에 개인별 뷰 없음) · 남과 비교 없음 ·
//   빈 상태는 "예시" 라벨 카드(실데이터 1건 들어오면 자동 교체 — 조건 렌더) + 행동 버튼.
//   내 노하우는 원문까지 본인이 직접 본다(0094 — 행 탭 = EntryDetailModal 재사용).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useHubStore } from '@/lib/store/useHubStore';
import { fetchMyTrainingHistory, type TrainingHistoryRow } from '@/lib/db';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useStoreNav } from '@/lib/hooks/useStoreNav';
import { storeColor } from '@/lib/utils/storeColor';
import { SectionLabel } from '@/components/SectionLabel';
import { MiniStats } from '@/components/blocks/MiniStats';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

const ENTRY_LIST_FIRST = 5; // 리스트 첫 노출 5±2 — 넘치면 "나머지 보기"로 아래로 펼침

// 통과 시각 표기 — "8월 2일". 연도는 생략(최근 이력 중심, 좁은 행 폭).
const fmtMonthDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export function JuniorGrowthView() {
  const growth = useHubStore((s) => s.growth);
  const growthLoaded = useHubStore((s) => s.growthLoaded);
  const hydrateGrowth = useHubStore((s) => s.hydrateGrowth);
  const myEntries = useHubStore((s) => s.myEntries);
  const myEntriesLoaded = useHubStore((s) => s.myEntriesLoaded);
  const hydrateMyEntries = useHubStore((s) => s.hydrateMyEntries);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const { goStore, switching } = useStoreNav();
  const [openEntry, setOpenEntry] = useState<PlaybookEntry | null>(null);
  const [showAllEntries, setShowAllEntries] = useState(false);
  // 훈련 통과 이력(0104) — 교차 매장·본인 한정. 통과만 저장되는 테이블이라 이력 = 통과 이력.
  const [trainingHistory, setTrainingHistory] = useState<TrainingHistoryRow[]>([]);
  const [trainingLoaded, setTrainingLoaded] = useState(false); // 부분 렌더 금지 게이트에 합류(빈상태↔실화면 플립 방지)
  const [showAllTraining, setShowAllTraining] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchMyTrainingHistory().then((rows) => {
      if (!alive) return;
      setTrainingHistory(rows);
      setTrainingLoaded(true); // 에러여도 []로 확정(readFail 로그) — 로딩에 갇히지 않는다
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    void hydrateGrowth();
    void hydrateMyEntries();
    void hydratePrefs();
  }, [hydrateGrowth, hydrateMyEntries, hydratePrefs]);

  const totals = useMemo(
    () =>
      growth.reduce(
        (a, r) => ({
          knowhow: a.knowhow + r.my_knowhow,
          hits: a.hits + r.my_hits,
          taught: a.taught + r.taught,
          doneKinds: a.doneKinds + r.done_kinds,
        }),
        { knowhow: 0, hits: 0, taught: 0, doneKinds: 0 },
      ),
    [growth],
  );
  // 훈련 통과만 있는 신입(업무 완료·노하우 0)도 실화면을 봐야 한다 — 이력이 있으면 빈 상태가 아니다.
  const empty = totals.knowhow === 0 && totals.taught === 0 && totals.doneKinds === 0 && trainingHistory.length === 0;
  const labelOf = (uid: string, fallback: string) => prefFor(uid).nickname || fallback;

  // 전부 도착 전엔 무조건 로딩 — 집계만 먼저 그리고 목록이 나중에 튀어나오는 부분 렌더 금지.
  if (!growthLoaded || !myEntriesLoaded || !trainingLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={InkColors.ink3} />
      </View>
    );
  }

  // ── 빈 상태: 골격 + 정직한 예시(라벨 명시·실데이터 들어오면 이 분기 자체가 사라짐) ──
  if (empty) {
    const firstUnit = growth[0]?.unit_id;
    return (
      <View style={{ gap: Space.md }}>
        <Appear delay={40}>
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>여기에 내가 남긴 것이 쌓여요</Text>
            <Text style={styles.emptyBody}>
              일하다 막히면 물어보고, 할일을 완료하면 그 기록이 이 화면에 모여요. 이 화면은 나만 볼 수 있어요.
            </Text>
            {firstUnit && (
              <Pressable
                onPress={() => goStore(firstUnit, '/junior/chat')}
                disabled={!!switching}
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel="물어보러 가기"
              >
                <Ionicons name="chatbubble-outline" size={15} color={InkColors.ink} />
                <Text style={styles.emptyBtnText}>물어보러 가기</Text>
              </Pressable>
            )}
          </View>
        </Appear>
        <Appear delay={80}>
          <View style={styles.ghostCard}>
            <View style={styles.exBadge}>
              <Text style={styles.exBadgeText}>예시</Text>
            </View>
            <Text style={styles.ghostTitle}>내 노하우가 최근 30일 7번 도움 됐어요</Text>
            <Text style={styles.ghostBody}>첫 기록이 들어오면 진짜 숫자로 바뀌어요.</Text>
          </View>
        </Appear>
      </View>
    );
  }

  return (
    <View style={{ gap: Space.md }}>
      {/* ── 가르침 실적(있을 때만) — 최고 역량 = 남을 도운 기록 ── */}
      {totals.taught > 0 && (
        <Appear delay={40}>
          <View style={[styles.card, styles.taughtCard]}>
            <View style={styles.taughtHead}>
              <Ionicons name="school-outline" size={18} color={InkColors.ink} />
              <Text style={styles.taughtTitle}>내 답이 매장 노하우가 됐어요</Text>
            </View>
            <Text style={styles.taughtCount}>{totals.taught}건</Text>
            <Text style={styles.caption}>그만둬도 매장에 남아, 다음 사람을 도와요</Text>
          </View>
        </Appear>
      )}

      {/* ── 내가 남긴 것 ── */}
      <Appear delay={totals.taught > 0 ? 80 : 40}>
        <SectionLabel title="내가 남긴 것" hint="나만 볼 수 있어요" />
        {/* 블록 I3 — 카드가 아니다. 2026-08-06: '내가 남긴 것'·'해본 업무'가 각각 stat을 품은 카드라
            이 화면이 '제목 → 카드' 반복이었다. 세 숫자를 한 줄로 올리고 아래 목록만 카드로 남긴다.
            '해본 업무'의 단독 1칸도 여기로 끌어올렸다 — 1칸짜리 통계에 카드를 세울 이유가 없다. */}
        <MiniStats
          items={[
            {
              key: 'knowhow',
              value: `${totals.knowhow}개`,
              label: '내가 만든 노하우',
            },
            {
              key: 'hits',
              value: `${totals.hits}번`,
              label: '최근 30일 참조',
              info:
                totals.knowhow > 0 && totals.hits === 0
                  ? {
                      title: '참조가 0이에요',
                      body: '아직 참조 전이에요 — 누가 같은 걸 물으면 숫자가 올라요.',
                    }
                  : undefined,
            },
            { key: 'done', value: `${totals.doneKinds}종`, label: '해본 업무' },
          ]}
        />
        <View style={styles.card}>
          {/* 내 노하우 원문 목록(0094) — 행 탭 = 원문 시트. 카운트와 같은 술어라 개수가 일치한다. */}
          {(showAllEntries ? myEntries : myEntries.slice(0, ENTRY_LIST_FIRST)).map((e) => (
            <Pressable
              key={e.id}
              onPress={() => setOpenEntry(e)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`노하우 ${e.title} 원문 보기`}
            >
              {growth.length > 1 && (
                <View style={[styles.dot, { backgroundColor: storeColor(e.unit_id, prefFor(e.unit_id).color) }]} />
              )}
              <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
              {(e.stats?.query_hits_30d ?? 0) > 0 && (
                <Text style={styles.rowSub}>{`${e.stats.query_hits_30d}번 참조`}</Text>
              )}
              <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
            </Pressable>
          ))}
          {!showAllEntries && myEntries.length > ENTRY_LIST_FIRST && (
            <Pressable
              onPress={() => setShowAllEntries(true)}
              style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="노하우 나머지 보기"
            >
              <Text style={styles.moreBtnText}>{`나머지 ${myEntries.length - ENTRY_LIST_FIRST}개 보기`}</Text>
            </Pressable>
          )}
        </View>
      </Appear>

      {/* ── 해본 업무 — 합계는 위 MiniStats로 올라갔다(2026-08-06). 여기 남는 건 매장별 분해뿐이라
             **다매장 직원에게만** 그린다. 단일 매장이면 위 숫자가 곧 그 매장의 값이라 섹션 자체가 사라진다.
             숙련 주장 없음(완료 ≠ 숙련). ── */}
      {growth.length > 1 && (
      <Appear delay={totals.taught > 0 ? 120 : 80}>
        <SectionLabel title="해본 업무" hint="매장별" />
        <View style={styles.card}>
          {/* 행 탭 = 그 매장 업무 화면 */}
          {growth.map((r) => (
              <Pressable
                key={r.unit_id}
                onPress={() => goStore(r.unit_id, '/junior/work')}
                disabled={!!switching}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.dot, { backgroundColor: storeColor(r.unit_id, prefFor(r.unit_id).color) }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>{labelOf(r.unit_id, r.store_name)}</Text>
                <Text style={styles.rowSub}>{`노하우 ${r.my_knowhow} · 해본 업무 ${r.done_kinds}종`}</Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </Pressable>
            ))}
        </View>
      </Appear>
      )}

      {/* ── 훈련 통과 이력(0104) — 있을 때만. 통과 사실만 말하고 점수·등급을 만들지 않는다 ── */}
      {trainingHistory.length > 0 && (
        <Appear delay={totals.taught > 0 ? 160 : 120}>
          <SectionLabel title="퀴즈" hint="통과한 퀴즈" />
          <View style={styles.card}>
            {(showAllTraining ? trainingHistory : trainingHistory.slice(0, ENTRY_LIST_FIRST)).map((h) => (
              <View key={`${h.unitId}_${h.entryId}`} style={styles.row}>
                {growth.length > 1 && (
                  <View style={[styles.dot, { backgroundColor: storeColor(h.unitId, prefFor(h.unitId).color) }]} />
                )}
                <Text style={styles.rowTitle} numberOfLines={1}>{h.entryTitle}</Text>
                <Text style={styles.rowSub}>{fmtMonthDay(h.verifiedAt)}</Text>
              </View>
            ))}
            {!showAllTraining && trainingHistory.length > ENTRY_LIST_FIRST && (
              <Pressable
                onPress={() => setShowAllTraining(true)}
                style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="퀴즈 이력 나머지 보기"
              >
                <Text style={styles.moreBtnText}>{`나머지 ${trainingHistory.length - ENTRY_LIST_FIRST}개 보기`}</Text>
              </Pressable>
            )}
          </View>
        </Appear>
      )}

      {/* 노하우 원문 시트 — 물어보기 [출처]와 동일 컴포넌트(읽기 전용) 재사용 */}
      <EntryDetailModal entry={openEntry} visible={!!openEntry} onClose={() => setOpenEntry(null)} />
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

  // 빈 상태
  emptyTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink, paddingTop: Space.xs },
  emptyBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, marginTop: Space.xs },
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
  ghostCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    opacity: 0.55,
    gap: 2,
  },
  exBadge: {
    alignSelf: 'flex-start',
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    marginBottom: Space.xs,
  },
  exBadgeText: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  ghostTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  ghostBody: { fontSize: 12.5, color: InkColors.ink3 },

  // 가르침 실적
  taughtCard: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellowDeep },
  taughtHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingTop: Space.xs },
  taughtTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  taughtCount: { fontSize: 28, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5, marginTop: 2 },
  caption: { fontSize: 11.5, color: InkColors.ink3, marginTop: Space.xs, marginBottom: Space.xs },

  statRow: { flexDirection: 'row', paddingVertical: Space.xs },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: InkColors.line },
  statV: { fontSize: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  statUnit: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  statL: { fontSize: 11.5, color: InkColors.ink3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm + 2, borderTopWidth: 1, borderTopColor: InkColors.line },
  moreBtn: { alignItems: 'center', paddingVertical: Space.sm + 2, borderTopWidth: 1, borderTopColor: InkColors.line },
  moreBtnText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: InkColors.ink, minWidth: 0 },
  rowSub: { fontSize: 12, color: InkColors.ink3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
