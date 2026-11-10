import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { formatRelative } from '@/components/coach/coachUtils';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchUnknownQueue } from '@/lib/db';
import { SPACE_KNOWHOW, SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { TouchSize } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { UnknownQuery } from '@/types';

/**
 * S05 공간 교육 탭(주인) — "답할 질문" 목록(대기 중 · 가장 오래 기다린 것부터). 행 → 답하기(S09).
 * 비면 "노하우 쓰기" 버튼(노하우가 늘면 AI 가 먼저 답한다). 교육 링크 칸(+ 새 교육 링크 · 링크 행)은 3번 덩이다.
 * 읽기 = fetchUnknownQueue(공간 번호). 매장 질문 스토어(useUnknownQueueStore)를 안 쓴다(매장 큐·앱 푸시와 섞이지 않게).
 * 탭에 돌아올 때마다 다시 읽는다(답한 질문이 바로 빠지게 · 공간 질문 실시간 구독은 아직 없다).
 */
export default function SpaceTeach() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const [questions, setQuestions] = useState<UnknownQuery[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setFailed(false);
    const { data, error } = await fetchUnknownQueue(spaceId);
    if (error) setFailed(true);
    else setQuestions(data.filter((q) => q.status === 'pending_owner_answer'));
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabTeach} line={spaceName} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      {failed && !questions ? (
        <LoadErrorState title={SPACE_KNOWHOW.queueLoadFail} onRetry={() => void load()} />
      ) : !questions ? (
        <ScreenLoading label={SPACE_KNOWHOW.queueLoading} />
      ) : questions.length === 0 ? (
        <EmptyState
          title={SPACE_KNOWHOW.queueEmptyTitle}
          body={SPACE_KNOWHOW.queueEmptyBody}
          cta={{ label: SPACE_KNOWHOW.add, onPress: () => router.push('/space/write') }}
        />
      ) : (
        <Section title={`${SPACE_KNOWHOW.queueTitle} ${questions.length}`}>
          <View style={styles.card}>
            {questions.map((q, i) => (
              <Pressable
                key={q.id}
                onPress={() => router.push({ pathname: '/space/answer/[qid]', params: { qid: q.id } })}
                accessibilityRole="button"
                accessibilityLabel={q.query_text}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{q.query_text}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {[
                      q.junior_name || SPACE_WORDS.guest,
                      formatRelative(q.asked_at),
                      q.similar_queries_count > 0 ? SPACE_KNOWHOW.sameAsked(q.similar_queries_count + 1) : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={Type.body.fontSize} color={TextColor.iconMuted} />
              </Pressable>
            ))}
          </View>
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: { ...CardStyles.rows },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowText: { flex: 1, gap: Space.xs },
  rowTitle: { ...Type.body, fontWeight: '700' },
  rowSub: { ...Type.desc },
});
