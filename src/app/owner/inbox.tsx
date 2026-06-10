import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { CategoryChip } from '@/components/CategoryChip';
import { InboxHeroCard } from '@/components/InboxHeroCard';
import { InboxRowItem } from '@/components/InboxRowItem';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

import { ALL_CATEGORIES, getCategoryMeta } from '@/lib/utils/category';
import { BrandColors, InkColors } from '@/lib/theme/colors';

import usersData from '@/data/users.json';
import type { Category, PlaybookEntry, UnknownQuery, UsersData } from '@/types';

const users = usersData as unknown as UsersData;
const MAX_LIST_ROWS = 6;
const TOP_RESOLVED = 5;

/**
 * Owner Inbox — C안 응답형 + 카테고리 다양성.
 * 1) 헤더 메타(매장·이번 주 처리 수)
 * 2) 카테고리 chip strip (전체 + 4종)
 * 3) Hero 우선 답변 1건 (가장 낮은 confidence)
 * 4) 나머지 pending 리스트 (최대 6, 카테고리 필터 적용)
 * 5) 처리됨 · 알바 인용 top 5 (resolution_rate desc → 최근 갱신 순)
 */
export default function OwnerInboxScreen() {
  const router = useRouter();
  const queue = useUnknownQueueStore((s) => s.queue);
  const loaded = useUnknownQueueStore((s) => s.loaded);
  const entries = usePlaybookStore((s) => s.entries);
  const userName = useSessionStore((s) => s.userName);

  // 'all' = 필터 해제. 그 외엔 해당 Category만.
  const [filter, setFilter] = useState<Category | 'all'>('all');

  // pending 정렬: 시급한 순(confidence asc) → 최근 순(asked_at desc)
  const pending = useMemo(() => sortByUrgency(queue.filter((u) => u.status === 'pending_owner_answer')), [queue]);
  const resolved = useMemo(() => queue.filter((u) => u.status === 'resolved_with_entry'), [queue]);

  // 카테고리별 pending 카운트 (chip 위 배지)
  const pendingCounts = useMemo(() => {
    const c: Record<Category, number> = { Routine: 0, Event: 0, Context: 0, 'Know-how': 0 };
    for (const u of pending) c[u.presumed_category] += 1;
    return c;
  }, [pending]);

  // 이번 주 처리 카운트
  const weeklyResolved = resolved.length;

  // hero: 카테고리 필터 무관, 전체 pending 중 가장 시급.
  const hero = pending[0];
  // 리스트: filter 적용. hero 제외하고 최대 6.
  const restAll = pending.slice(1);
  const restFiltered = filter === 'all' ? restAll : restAll.filter((u) => u.presumed_category === filter);
  const restRows = restFiltered.slice(0, MAX_LIST_ROWS);

  // 처리됨 - 인용 top 5
  const topCited = useMemo(() => topCitedEntries(entries, TOP_RESOLVED), [entries]);

  // 박지원 career_days lookup (hero 메타에 노출)
  const careerDays = useMemo(() => {
    if (!hero) return undefined;
    const j = users.staff.find((s) => s.id === hero.junior_id);
    return j?.career_days;
  }, [hero]);

  const goAnswer = (uqId: string) => router.push({ pathname: '/owner/answer/[uqId]', params: { uqId } });

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <Stack.Screen
        options={{
          title: `${userName} 사장님`,
        }}
      />

      {!loaded ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={styles.loadingText}>질문을 불러오는 중...</Text>
        </View>
      ) : (
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 1) 상단 보조 메타 */}
        <Text style={styles.subline}>지금까지 {weeklyResolved}건 처리됨</Text>

        {/* 2) 카테고리 chip strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipStrip}
        >
          <AllChip selected={filter === 'all'} count={pending.length} onPress={() => setFilter('all')} />
          {ALL_CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat}
              category={cat}
              size="md"
              count={pendingCounts[cat]}
              selected={filter === cat}
              onPress={() => setFilter(filter === cat ? 'all' : cat)}
            />
          ))}
        </ScrollView>

        {/* 3) Hero — 우선 답변 */}
        {hero ? (
          <View style={styles.heroWrap}>
            <Text style={styles.sectionTag}>우선 답변</Text>
            <InboxHeroCard uq={hero} careerDays={careerDays} onPress={() => goAnswer(hero.id)} />
          </View>
        ) : (
          <View style={styles.emptyHero}>
            <Text style={styles.emptyTitle}>아직 새 질문이 없어요</Text>
            <Text style={styles.emptySub}>알바가 모르는 걸 물으면 여기로 와요.</Text>
          </View>
        )}

        {/* 4) 나머지 pending 리스트 */}
        {restRows.length > 0 && (
          <View style={styles.listWrap}>
            <Text style={styles.sectionTitle}>
              나머지 {filter === 'all' ? '질문' : `${getCategoryMeta(filter).label} 질문`}
            </Text>
            <View style={styles.list}>
              {restRows.map((uq) => (
                <InboxRowItem key={uq.id} uq={uq} onPress={() => goAnswer(uq.id)} />
              ))}
            </View>
            {restFiltered.length > MAX_LIST_ROWS && (
              <Text style={styles.moreHint}>+ {restFiltered.length - MAX_LIST_ROWS}건 더 있음</Text>
            )}
          </View>
        )}

        {/* 5) 구분선 */}
        <View style={styles.divider} />

        {/* 6) 처리됨 · 인용 카운트 */}
        <View style={styles.resolvedWrap}>
          <Text style={styles.resolvedHeader}>처리됨 · 알바가 잘 쓰고 있어요</Text>
          <Text style={styles.resolvedSub}>당신의 노하우가 매장을 굴리는 중</Text>

          <View style={styles.resolvedList}>
            {topCited.map((e) => (
              <ResolvedRow key={e.id} entry={e} />
            ))}
          </View>
        </View>

        {/* 푸터 여백 */}
        <View style={{ height: 16 }} />
      </ScrollView>
      )}

    </SafeAreaView>
  );
}

// ─── 보조 컴포넌트 ─────────────────────────────────────────

function AllChip({ selected, count, onPress }: { selected: boolean; count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
      <View
        style={[
          allChipStyles.chip,
          {
            backgroundColor: selected ? InkColors.ink : '#FFFFFF',
            borderColor: selected ? InkColors.ink : InkColors.line,
          },
        ]}
      >
        <Text style={[allChipStyles.label, { color: selected ? '#FFFFFF' : InkColors.ink }]}>전체</Text>
        <View style={[allChipStyles.count, { backgroundColor: selected ? 'rgba(255,255,255,0.25)' : InkColors.ink }]}>
          <Text style={allChipStyles.countText}>{count}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function ResolvedRow({ entry }: { entry: PlaybookEntry }) {
  return (
    <View style={resolvedStyles.row}>
      <CategoryChip category={entry.category} size="sm" showLabel={false} />
      <View style={resolvedStyles.body}>
        <Text style={resolvedStyles.title} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={resolvedStyles.meta}>
          v{entry.version} · 최근 30일 +{entry.stats.query_hits_30d}회 인용 ✨
        </Text>
      </View>
    </View>
  );
}

// ─── 정렬·도우미 ──────────────────────────────────────────

function sortByUrgency(list: UnknownQuery[]): UnknownQuery[] {
  return [...list].sort((a, b) => {
    if (a.best_match_confidence !== b.best_match_confidence) {
      return a.best_match_confidence - b.best_match_confidence;
    }
    return new Date(b.asked_at).getTime() - new Date(a.asked_at).getTime();
  });
}

function topCitedEntries(entries: PlaybookEntry[], n: number): PlaybookEntry[] {
  return [...entries]
    .filter((e) => e.status === 'published')
    .sort((a, b) => {
      const rr = b.stats.resolution_rate - a.stats.resolution_rate;
      if (rr !== 0) return rr;
      // 동률이면 최근 갱신 순 — 방금 답한 노하우가 '처리됨' 상단에 바로 보이게.
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .slice(0, n);
}

// ─── 스타일 ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 18,
  },
  subline: {
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '600',
  },
  chipStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingRight: 8,
  },
  heroWrap: { gap: 8 },
  sectionTag: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: BrandColors.accent,
    textTransform: 'uppercase',
  },
  emptyHero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 24,
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  emptySub: { fontSize: 14, color: InkColors.ink3 },
  listWrap: { gap: 8 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: InkColors.ink2,
  },
  list: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 14,
  },
  moreHint: {
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '600',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: InkColors.line,
    marginVertical: 4,
  },
  resolvedWrap: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: 14,
    padding: 18,
    gap: 4,
  },
  resolvedHeader: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  resolvedSub: { fontSize: 13, color: InkColors.ink3, marginBottom: 8 },
  resolvedList: { gap: 0 },
});

const allChipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  count: {
    minWidth: 18,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
});

const resolvedStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: InkColors.ink,
  },
  meta: {
    fontSize: 12,
    color: InkColors.ink3,
    fontWeight: '600',
  },
});
