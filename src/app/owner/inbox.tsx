import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CategoryChip } from '@/components/CategoryChip';
import { InboxHeroCard } from '@/components/InboxHeroCard';
import { InboxSubtabs } from '@/components/InboxSubtabs';
import { SimilarGroupRow } from '@/components/SimilarGroupRow';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

import { useStaffStore } from '@/lib/store/useStaffStore';
import type { PlaybookEntry, UnknownQuery } from '@/types';

const TOP_RESOLVED = 5;

/**
 * Owner Inbox — 받은질문 시니어(사장님) 인박스.
 * 1) 상단 보조 메타(지금까지 처리 수)
 * 2) Hero 우선 답변 1건 (가장 시급 = confidence 최저)
 * 3) <InboxSubtabs> [대기 | 자동응답 | 보관] — 상태별 파생 필터·카운트는 컴포넌트가 처리.
 *    각 행은 <SimilarGroupRow> (유사 질문 N건 묶음 + 보관/자동응답 인라인 액션).
 *    행 탭 → 대화형 답변(owner/coach). 등록 시 노하우 생성 + resolve.
 * 4) 처리됨 · 알바 인용 top 5
 */
export default function OwnerInboxScreen() {
  const router = useRouter();
  const queue = useUnknownQueueStore((s) => s.queue);
  const loaded = useUnknownQueueStore((s) => s.loaded);
  const archive = useUnknownQueueStore((s) => s.archive);
  const enableAutoAnswer = useUnknownQueueStore((s) => s.enableAutoAnswer);

  const entries = usePlaybookStore((s) => s.entries);
  const userName = useSessionStore((s) => s.userName);
  const getStaff = useStaffStore((s) => s.getStaff);

  // 노하우 제안(알바→사장) — 받은질문과 함께 '직원 인풋' 허브로. 진입 시 당겨오고 실시간 구독.
  const sugHydrate = useSuggestionStore((s) => s.hydrate);
  const sugSubscribe = useSuggestionStore((s) => s.subscribe);
  const pendingSuggestions = useSuggestionStore((s) => s.suggestions.filter((x) => x.status === 'pending').length);
  useEffect(() => {
    sugHydrate();
    return sugSubscribe();
  }, [sugHydrate, sugSubscribe]);

  // pending 정렬: 시급한 순(confidence asc) → 최근 순(asked_at desc)
  const pending = useMemo(
    () => sortByUrgency(queue.filter((u) => u.status === 'pending_owner_answer')),
    [queue],
  );
  const resolved = useMemo(() => queue.filter((u) => u.status === 'resolved_with_entry'), [queue]);

  // 누적 처리 카운트(전체 기간) — 상단 보조 메타 '지금까지 답한 질문 N건'
  const weeklyResolved = resolved.length;

  // hero: 전체 pending 중 가장 시급. 깊은 답변 → 기존 answer 위저드.
  const hero = pending[0];

  // 처리됨 - 인용 top 5
  const topCited = useMemo(() => topCitedEntries(entries, TOP_RESOLVED), [entries]);

  // hero 작성자 경력(익명이면 숨김).
  const careerDays = useMemo(() => {
    if (!hero || hero.anonymous) return undefined;
    return getStaff(hero.junior_id)?.career_days;
  }, [hero, getStaff]);

  // 행/Hero 탭 → 대화형 답변(coach). 질문 컨텍스트가 첫 말풍선으로 열린다.
  const goAnswer = useCallback(
    (uqId: string) => router.push({ pathname: '/owner/coach', params: { uqId } }),
    [router],
  );
  const openAnswer = useCallback((uq: UnknownQuery) => goAnswer(uq.id), [goAnswer]);

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <Stack.Screen options={{ title: `${userName} 사장님` }} />

      {!loaded ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={styles.loadingText}>질문을 불러오는 중...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* 1) 상단 보조 메타 */}
          <Text style={styles.subline}>지금까지 답한 질문 {weeklyResolved}건</Text>

          {/* 노하우 제안 진입 — 알바가 올린 개선·등록 신청(받은질문과 같은 '직원 인풋' 허브) */}
          <Pressable
            onPress={() => router.push('/owner/suggestions')}
            style={({ pressed }) => [styles.sugEntry, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`노하우 제안 ${pendingSuggestions}건, 보러 가기`}
          >
            <View style={styles.sugIcon}>
              <Ionicons name="bulb-outline" size={17} color={InkColors.ink} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sugTitle}>노하우 제안</Text>
              <Text style={styles.sugSub}>
                {pendingSuggestions > 0 ? '알바가 올린 개선·등록 신청을 확인하세요' : '알바가 노하우를 제안하면 여기로 와요'}
              </Text>
            </View>
            {pendingSuggestions > 0 && (
              <View style={styles.sugBadge}>
                <Text style={styles.sugBadgeText}>{pendingSuggestions > 99 ? '99+' : pendingSuggestions}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </Pressable>

          {/* 2) Hero — 우선 답변 (가장 시급한 미답변) */}
          {hero ? (
            <Appear style={styles.heroWrap} offsetY={12}>
              <Text style={styles.sectionTag}>우선 답변</Text>
              <InboxHeroCard uq={hero} careerDays={careerDays} onPress={() => goAnswer(hero.id)} />
            </Appear>
          ) : (
            <View style={styles.emptyHero}>
              <Text style={styles.emptyTitle}>아직 새 질문이 없어요</Text>
              <Text style={styles.emptySub}>알바가 모르는 걸 물으면 여기로 와요.</Text>
            </View>
          )}

          {/* 3) 서브탭 [대기 | 자동응답 | 보관] — 상태별 필터·카운트는 InboxSubtabs가 처리 */}
          <View style={styles.subtabsWrap}>
            <InboxSubtabs
              queue={queue}
              initial="pending"
              renderRow={(uq) => (
                <SimilarGroupRow
                  uq={uq}
                  onPress={openAnswer}
                  onArchive={uq.status === 'archived' ? undefined : (u) => archive(u.id)}
                  onAutoAnswer={
                    uq.status === 'pending_owner_answer' ? (u) => enableAutoAnswer(u.id) : undefined
                  }
                />
              )}
            />
          </View>

          {/* 4) 구분선 */}
          <View style={styles.divider} />

          {/* 5) 처리됨 · 인용 카운트 */}
          <View style={styles.resolvedWrap}>
            <Text style={styles.resolvedHeader}>처리됨 · 알바가 잘 쓰고 있어요</Text>
            <Text style={styles.resolvedSub}>사장님 노하우가 매장을 돌리고 있어요</Text>

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

      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

// ─── 보조 컴포넌트 ─────────────────────────────────────────

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
  sugEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
    ...Elevation.e1,
  },
  sugIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sugTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sugSub: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600', marginTop: 2 },
  sugBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sugBadgeText: { fontSize: 12, fontWeight: '900', color: InkColors.bubbleText },
  heroWrap: { gap: 8 },
  sectionTag: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: BrandColors.accent,
    textTransform: 'uppercase',
  },
  emptyHero: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 24,
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  emptySub: { fontSize: 14, color: InkColors.ink3 },
  // InboxSubtabs는 자체 좌우 패딩(16)을 가지므로 화면 패딩(20)을 상쇄해 카드 폭을 맞춘다.
  subtabsWrap: { marginHorizontal: -4 },
  divider: {
    height: 1,
    backgroundColor: InkColors.line,
    marginVertical: 4,
  },
  resolvedWrap: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    padding: 18,
    gap: 4,
  },
  resolvedHeader: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  resolvedSub: { fontSize: 13, color: InkColors.ink3, marginBottom: 8 },
  resolvedList: { gap: 0 },
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
