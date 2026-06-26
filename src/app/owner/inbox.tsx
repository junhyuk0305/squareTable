import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { CategoryChip } from '@/components/CategoryChip';
import { InboxHeroCard } from '@/components/InboxHeroCard';
import { InboxSubtabs } from '@/components/InboxSubtabs';
import { SimilarGroupRow } from '@/components/SimilarGroupRow';
import { VoiceAnswerSheet } from '@/components/VoiceAnswerSheet';
import { RoleTabBar } from '@/components/RoleTabBar';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

import { buildPlaybookEntry } from '@/lib/utils/buildEntry';
import { BrandColors, InkColors } from '@/lib/theme/colors';

import { useStaffStore } from '@/lib/store/useStaffStore';
import type { PlaybookEntry, UnknownQuery } from '@/types';

const TOP_RESOLVED = 5;

/**
 * Owner Inbox — 받은질문 시니어(사장님) 인박스.
 * 1) 상단 보조 메타(지금까지 처리 수)
 * 2) Hero 우선 답변 1건 (가장 시급 = confidence 최저)
 * 3) <InboxSubtabs> [대기 | 자동응답 | 보관] — 상태별 파생 필터·카운트는 컴포넌트가 처리.
 *    각 행은 <SimilarGroupRow> (유사 질문 N건 묶음 + 보관/자동응답 인라인 액션).
 *    행 탭 → 음성 1터치 답변(VoiceAnswerSheet). 등록 시 노하우 생성 + resolve.
 * 4) 처리됨 · 알바 인용 top 5
 */
export default function OwnerInboxScreen() {
  const router = useRouter();
  const queue = useUnknownQueueStore((s) => s.queue);
  const loaded = useUnknownQueueStore((s) => s.loaded);
  const archive = useUnknownQueueStore((s) => s.archive);
  const enableAutoAnswer = useUnknownQueueStore((s) => s.enableAutoAnswer);
  const resolve = useUnknownQueueStore((s) => s.resolve);

  const entries = usePlaybookStore((s) => s.entries);
  const addEntry = usePlaybookStore((s) => s.add);
  const userName = useSessionStore((s) => s.userName);
  const getStaff = useStaffStore((s) => s.getStaff);

  // 음성 빠른 답변 시트 — 행 탭으로 열림.
  const [voiceTarget, setVoiceTarget] = useState<UnknownQuery | null>(null);

  // pending 정렬: 시급한 순(confidence asc) → 최근 순(asked_at desc)
  const pending = useMemo(
    () => sortByUrgency(queue.filter((u) => u.status === 'pending_owner_answer')),
    [queue],
  );
  const resolved = useMemo(() => queue.filter((u) => u.status === 'resolved_with_entry'), [queue]);

  // 이번 주 처리 카운트
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

  const goAnswer = (uqId: string) =>
    router.push({ pathname: '/owner/answer/[uqId]', params: { uqId } });

  // 행 탭 → 음성 빠른 답변 시트.
  const openVoice = useCallback((uq: UnknownQuery) => setVoiceTarget(uq), []);
  const closeVoice = useCallback(() => setVoiceTarget(null), []);

  // 음성 답변 등록 → 답변 텍스트를 노하우로 발행하고 질문을 해결 처리.
  // 빠른 경로라 위저드를 거치지 않고, 발화 한 줄을 '할 행동' step으로 정규화한다(기존 buildPlaybookEntry 재사용).
  const submitVoice = useCallback(
    (answerText: string) => {
      const uq = voiceTarget;
      if (!uq) return;
      const entry = buildPlaybookEntry(uq, { actions: [answerText.trim()] });
      addEntry(entry);
      resolve(uq.id, entry.id);
    },
    [voiceTarget, addEntry, resolve],
  );

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
          <Text style={styles.subline}>지금까지 {weeklyResolved}건 처리됨</Text>

          {/* 2) Hero — 우선 답변 (가장 시급한 미답변) */}
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

          {/* 3) 서브탭 [대기 | 자동응답 | 보관] — 상태별 필터·카운트는 InboxSubtabs가 처리 */}
          <View style={styles.subtabsWrap}>
            <InboxSubtabs
              queue={queue}
              initial="pending"
              renderRow={(uq) => (
                <SimilarGroupRow
                  uq={uq}
                  onPress={openVoice}
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

      {/* 음성 1터치 답변 시트 (프레임캡은 시트 내부에서 처리) */}
      <VoiceAnswerSheet
        visible={voiceTarget !== null}
        uq={voiceTarget}
        onClose={closeVoice}
        onSubmit={submitVoice}
      />

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
  // InboxSubtabs는 자체 좌우 패딩(16)을 가지므로 화면 패딩(20)을 상쇄해 카드 폭을 맞춘다.
  subtabsWrap: { marginHorizontal: -4 },
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
