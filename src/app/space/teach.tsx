import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { EmptyState } from '@/components/EmptyState';
import { EduLinkRows } from '@/components/edu/EduLinkRows';
import { useEduLinksOn } from '@/components/edu/LinkFormStore';
import { SpaceQuestionRows } from '@/components/place/SpaceQuestionRows';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchEduLinks, fetchEntries, fetchUnknownQueue, subscribeUnknownQueue, type EduLinkRow } from '@/lib/db';
import { subscribeDebounced } from '@/lib/store/realtimeSync';
import { SPACE_KNOWHOW, SPACE_SCREEN, STORE_LINK_LIST } from '@/lib/place/words';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import type { UnknownQuery } from '@/types';

/**
 * S05 공간 교육 탭(주인) — 교육 링크 칸(+ 새 교육 링크 → S10 · 링크 줄 → S11) + "답할 질문" 목록(대기 중 · 오래 기다린 것부터 · 줄 → S09).
 * 교육 링크 칸은 공간 교육 링크 스위치(eduLinksOpenOf(features,'space') · 매장과 같은 판정)가 켜졌을 때만 그린다(2026-11-16 R-4).
 * 답할 질문이 없으면 빈 상태 + 다음 행동 버튼 하나(노하우 0개 = 노하우 쓰기 · 링크 0개 = 교육 링크 만들기 · 둘 다 있으면 버튼 없음).
 *   처음 순서 안내(3단계)는 2026-11-17 홈 시작 카드 한 곳으로 옮겼다(화면조립표 7절 · 묶음 J-2).
 *   링크가 아직 없으면 링크 칸을 따로 그리지 않는다(빈 상태의 "교육 링크 만들기"와 같은 버튼이 둘 생긴다).
 * 읽기 = fetchUnknownQueue · fetchEntries · fetchEduLinks(공간 번호). 매장 질문 스토어(useUnknownQueueStore)를 안 쓴다(매장 큐·앱 푸시와 섞이지 않게).
 * 탭에 돌아올 때마다 다시 읽는다(답한 질문이 바로 빠지고 만든 링크가 바로 보이게).
 * ★night-1111 g5: 새 질문·다른 기기에서 답한 질문도 실시간으로 맞춘다(subscribeUnknownQueue(공간 번호) · 300ms 묶음).
 */
export default function SpaceTeach() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const linksOn = useEduLinksOn('space') === true;
  const [questions, setQuestions] = useState<UnknownQuery[] | null>(null);
  const [knowhowCount, setKnowhowCount] = useState<number | null>(null);
  const [links, setLinks] = useState<EduLinkRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  // L20: 마지막 요청의 응답만 쓴다. 화면을 떠났거나 공간이 바뀐 뒤 늦게 온 응답은 버린다.
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!spaceId) return;
    const my = ++seq.current;
    setFailed(false);
    const [q, kn, ln] = await Promise.all([fetchUnknownQueue(spaceId), fetchEntries(spaceId), fetchEduLinks(spaceId)]);
    if (my !== seq.current) return;
    if (q.error) setFailed(true);
    else setQuestions(q.data.filter((x) => x.status === 'pending_owner_answer'));
    // 노하우·링크를 못 읽으면 안내 단계를 "안 함"으로 단정하지 않는다 = 지난 값을 둔다(처음이면 0 · 빈 목록).
    if (!kn.error) setKnowhowCount(kn.data.filter((e) => e.status !== 'draft').length);
    else setKnowhowCount((n) => n ?? 0);
    if (ln.data) setLinks(ln.data);
    else setLinks((l) => l ?? []);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { seq.current++; };
    }, [load]),
  );

  useEffect(() => {
    if (!spaceId) return;
    return subscribeDebounced((cb) => subscribeUnknownQueue(cb, spaceId), () => void load(), 300, 'space_teach');
  }, [spaceId, load]);

  const write = () => router.push('/space/write');
  const newLink = () => router.push({ pathname: '/space/link/new', params: { unit: spaceId } });
  const openLink = (id: string) => router.push({ pathname: '/space/link/[id]', params: { id, unit: spaceId } });

  const header = <ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabTeach} line={spaceName} />;
  if (failed && !questions) {
    return (
      <Screen header={header} tabBar="space">
        <Stack.Screen options={{ headerShown: false }} />
        <LoadErrorState title={SPACE_KNOWHOW.queueLoadFail} onRetry={() => void load()} />
      </Screen>
    );
  }
  if (!questions || knowhowCount === null || links === null) {
    return (
      <Screen header={header} tabBar="space">
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenLoading label={SPACE_KNOWHOW.queueLoading} />
      </Screen>
    );
  }

  const hasLinks = linksOn && links.length > 0;
  // 빈 상태의 다음 행동(홈 시작 카드와 같은 순서). 둘 다 했으면 할 일이 없으니 버튼 없이 문구만.
  const next = knowhowCount === 0 ? { label: SPACE_KNOWHOW.guideWrite, onPress: write } : linksOn && links.length === 0 ? { label: SPACE_KNOWHOW.guideLink, onPress: newLink } : undefined;

  return (
    <Screen header={header} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      {/* [새 교육 링크] = 매장 교육 링크 목록과 같은 노란 주 버튼(2026-11-16 R-10). */}
      {hasLinks ? (
        <Pressable
          onPress={newLink}
          accessibilityRole="button"
          accessibilityLabel={STORE_LINK_LIST.newLink}
          style={({ pressed }) => [styles.newLink, pressed && styles.pressed]}
        >
          <Text style={styles.newLinkText}>{STORE_LINK_LIST.newLink}</Text>
        </Pressable>
      ) : null}
      {hasLinks ? (
        <Section title={SPACE_KNOWHOW.linksTitle}>
          <EduLinkRows links={links} onOpen={openLink} />
        </Section>
      ) : null}

      {questions.length === 0 ? (
        <EmptyState title={SPACE_KNOWHOW.queueEmptyTitle} body={SPACE_KNOWHOW.queueEmptyBody} cta={next} />
      ) : (
        <Section title={`${SPACE_KNOWHOW.queueTitle} ${questions.length}`}>
          <SpaceQuestionRows questions={questions} onOpen={(q) => router.push({ pathname: '/space/answer/[qid]', params: { qid: q.id } })} />
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  newLink: ButtonStyles.primaryYellow,
  newLinkText: ButtonTextStyles.primaryOnYellow,
});
