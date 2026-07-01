import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { InboxHeroCard } from '@/components/InboxHeroCard';
import { InboxSubtabs } from '@/components/InboxSubtabs';
import { SimilarGroupRow } from '@/components/SimilarGroupRow';
import { SectionLabel } from '@/components/SectionLabel';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { useStaffStore } from '@/lib/store/useStaffStore';
import type { PlaybookEntry, UnknownQuery } from '@/types';

// 안 쓰임 = 게시됐는데 최근 30일 인용 0회. (OwnerKnowhowBrowse의 isUnused와 동일 기준)
const isUnused = (e: PlaybookEntry) =>
  e.status === 'published' && (e.stats?.query_hits_30d ?? 0) === 0;

/**
 * Owner Inbox — 받은질문 시니어(사장님) 인박스 = 질문 처리 대시보드.
 * 1) 한눈에 보기 — 요약 스트립(답할 질문·AI가 답함·내 노하우) + AI 자동응답률(누적)
 * 2) 노하우 제안 진입 (알바→사장)
 * 3) Hero 우선 답변 1건 (가장 시급 = confidence 최저)
 * 4) <InboxSubtabs> [답할 질문 | AI가 답함] — 상태별 파생 필터·카운트는 컴포넌트가 처리.
 * 5) '그동안 쌓은 노하우' 진입 카드 → /owner/knowledge (안 쓰임 있으면 바로 그 필터로)
 */
export default function OwnerInboxScreen() {
  const router = useRouter();
  const queue = useUnknownQueueStore((s) => s.queue);
  const loaded = useUnknownQueueStore((s) => s.loaded);
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

  // 상태별 카운트(누적).
  const autoCount = useMemo(() => queue.filter((u) => u.status === 'auto_answered').length, [queue]);
  const resolvedCount = useMemo(() => queue.filter((u) => u.status === 'resolved_with_entry').length, [queue]);

  // AI 자동응답률(누적) = AI가 답함 / 답변된 질문(= AI가 답함 + 사장이 답함).
  const answered = autoCount + resolvedCount;
  const ratePct = answered > 0 ? Math.round((autoCount / answered) * 100) : 0;

  // 내 노하우 · 안 쓰임 카운트(진입 카드).
  const knowhowCount = entries.length;
  const unusedCount = useMemo(() => entries.filter(isUnused).length, [entries]);

  // hero: 전체 pending 중 가장 시급. 깊은 답변 → 기존 answer 위저드.
  const hero = pending[0];

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

  // '그동안 쌓은 노하우' → 노하우 화면. 안 쓰임이 있으면 바로 그 필터로 진입.
  const goKnowledge = useCallback(() => {
    if (unusedCount > 0) router.push({ pathname: '/owner/knowledge', params: { unused: '1' } });
    else router.push('/owner/knowledge');
  }, [router, unusedCount]);

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
          {/* 1) 한눈에 보기 — 요약 스트립 + 자동응답률 */}
          <View style={styles.block}>
            <SectionLabel title="한눈에 보기" />
            <View style={styles.summary}>
              <StatCard n={pending.length} label="답할 질문" hot={pending.length > 0} />
              <StatCard n={autoCount} label="AI가 답함" />
              <StatCard n={knowhowCount} label="내 노하우" />
            </View>

            {answered > 0 && (
              <View style={styles.rateCard}>
                <View style={styles.rateTop}>
                  <Text style={styles.rateTitle}>AI 자동응답률</Text>
                  <Text style={styles.ratePct}>{ratePct}%</Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${ratePct}%` }]} />
                </View>
                <Text style={styles.rateCap}>
                  지금까지 답한 질문 {answered}건 중 {autoCount}건을 AI가 바로 답했어요
                </Text>
              </View>
            )}
          </View>

          {/* 2) 노하우 제안 진입 — 알바가 올린 개선·등록 신청(받은질문과 같은 '직원 인풋' 허브) */}
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

          {/* 3) Hero — 우선 답변 (가장 시급한 미답변) */}
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

          {/* 4) 서브탭 [답할 질문 | AI가 답함] — 상태별 필터·카운트는 InboxSubtabs가 처리. */}
          <InboxSubtabs
            queue={queue}
            initial="pending"
            renderRow={(uq) => (
              <SimilarGroupRow
                uq={uq}
                onPress={openAnswer}
                onAutoAnswer={
                  uq.status === 'pending_owner_answer' ? (u) => enableAutoAnswer(u.id) : undefined
                }
              />
            )}
          />

          {/* 5) 그동안 쌓은 노하우 — 진입 카드(목록은 상세 화면에서). 안 쓰임 있으면 정리 유도. */}
          <View style={styles.block}>
            <SectionLabel title="그동안 쌓은 노하우" />
            <Pressable
              onPress={goKnowledge}
              style={({ pressed }) => [styles.sugEntry, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`내 노하우 ${knowhowCount}개${unusedCount > 0 ? `, 안 쓰임 ${unusedCount}개` : ''}, 관리하기`}
            >
              <View style={[styles.sugIcon, styles.sugIconKnow]}>
                <Ionicons name="library-outline" size={17} color={InkColors.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sugTitle}>내 노하우 {knowhowCount}개</Text>
                <Text style={styles.sugSub}>
                  {unusedCount > 0 ? (
                    <>
                      <Text style={styles.sugSubBad}>{unusedCount}개는 최근 안 쓰였어요</Text> · 확인해볼까요?
                    </>
                  ) : (
                    '잘 쌓이고 있어요. 탭해서 관리하기'
                  )}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
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

/** 요약 스트립 카드 1칸. hot(=답할 질문 있음)이면 노랑 강조 + 빨간 점. */
function StatCard({ n, label, hot }: { n: number; label: string; hot?: boolean }) {
  return (
    <View style={[styles.stat, hot && styles.statHot]}>
      <View style={styles.statNumRow}>
        {hot ? <View style={styles.statDot} /> : null}
        <Text style={styles.statNum}>{n}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
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

// ─── 스타일 ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  scroll: {
    paddingHorizontal: Space.gutter,
    paddingTop: Space.md,
    paddingBottom: Space.xl,
    gap: Space.lg,
  },

  // 섹션 블록 = [밖 라벨] + [내용]
  block: { gap: Space.sm },

  // 요약 스트립
  summary: { flexDirection: 'row', gap: Space.sm },
  stat: {
    flex: 1,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 3,
    ...Elevation.e1,
  },
  statHot: { borderColor: BrandColors.yellowDeep, backgroundColor: '#FFFBEA' },
  statNumRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statDot: { width: 7, height: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.bad },
  statNum: { fontSize: 26, fontWeight: '800', letterSpacing: -1, color: InkColors.ink, lineHeight: 28 },
  statLabel: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },

  // 자동응답률 게이지
  rateCard: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    padding: 16,
    gap: 9,
    ...Elevation.e1,
  },
  rateTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rateTitle: { fontSize: 13, fontWeight: '700', color: InkColors.ink },
  ratePct: { fontSize: 16, fontWeight: '800', color: BrandColors.yellowDeep },
  bar: { height: 9, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  rateCap: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

  // 진입 카드(노하우 제안 · 내 노하우 공용)
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
  sugIconKnow: { backgroundColor: InkColors.bgSoft },
  sugTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sugSub: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600', marginTop: 2 },
  sugSubBad: { color: BrandColors.bad, fontWeight: '800' },
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
});
