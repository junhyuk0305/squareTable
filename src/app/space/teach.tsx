import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { EduLinkRows } from '@/components/edu/EduLinkRows';
import { useEduLinksOn } from '@/components/edu/LinkFormStore';
import { formatRelative } from '@/components/coach/coachUtils';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchEduLinks, fetchEntries, fetchUnknownQueue, subscribeUnknownQueue, type EduLinkRow } from '@/lib/db';
import { subscribeDebounced } from '@/lib/store/realtimeSync';
import { SPACE_KNOWHOW, SPACE_SCREEN, SPACE_WORDS, STORE_LINK_LIST } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Gap, Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { Type } from '@/lib/theme/type';
import type { UnknownQuery } from '@/types';

type Step = { key: 'write' | 'link' | 'answer'; title: string; hint: string; done: boolean };

/**
 * S05 공간 교육 탭(주인) — 교육 링크 칸(+ 새 교육 링크 → S10 · 링크 줄 → S11) + "답할 질문" 목록(대기 중 · 오래 기다린 것부터 · 줄 → S09).
 * 교육 링크 칸은 공간 교육 링크 스위치(eduLinksOpenOf(features,'space') · 매장과 같은 판정)가 켜졌을 때만 그린다(2026-11-16 R-4).
 * 답할 질문이 없으면 처음 순서 안내: 노하우 쓰기 → 교육 링크 만들기 → 질문에 답하기. 지금 할 단계 하나만 주 버튼이다.
 *   링크가 아직 없으면 링크 칸을 따로 그리지 않는다(안내의 "교육 링크 만들기"와 같은 버튼이 둘 생긴다).
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
  const steps: Step[] = [
    { key: 'write', title: SPACE_KNOWHOW.guideWrite, hint: SPACE_KNOWHOW.guideWriteHint, done: knowhowCount > 0 },
    ...(linksOn ? [{ key: 'link' as const, title: SPACE_KNOWHOW.guideLink, hint: SPACE_KNOWHOW.guideLinkHint, done: links.length > 0 }] : []),
    { key: 'answer', title: SPACE_KNOWHOW.guideAnswer, hint: SPACE_KNOWHOW.guideAnswerHint, done: false },
  ];
  const now = steps.find((s) => !s.done)?.key;
  const primary = now === 'write' ? { label: SPACE_KNOWHOW.guideWrite, onPress: write } : now === 'link' ? { label: SPACE_KNOWHOW.guideLink, onPress: newLink } : null;

  return (
    <Screen header={header} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      {hasLinks ? (
        <Section
          title={SPACE_KNOWHOW.linksTitle}
          trailing={
            <Pressable
              onPress={newLink}
              accessibilityRole="button"
              accessibilityLabel={STORE_LINK_LIST.newLink}
              style={({ pressed }) => [styles.small, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={Type.body.fontSize} color={InkColors.ink} />
              <Text style={styles.smallText}>{STORE_LINK_LIST.newLink}</Text>
            </Pressable>
          }
        >
          <EduLinkRows links={links} onOpen={openLink} />
        </Section>
      ) : null}

      {questions.length === 0 ? (
        <Section title={SPACE_KNOWHOW.guideTitle}>
          <View style={styles.card}>
            {steps.map((s, i) => (
              <View key={s.key} style={[styles.step, i > 0 && styles.rowLine]}>
                <View style={[styles.stepNo, s.done && styles.stepNoDone, s.key === now && styles.stepNoNow]}>
                  {s.done ? (
                    <Ionicons name="checkmark" size={Type.desc.fontSize} color={InkColors.bubbleText} />
                  ) : (
                    <Text style={[styles.stepNoText, s.key === now && styles.stepNoTextNow]}>{i + 1}</Text>
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, s.done && styles.doneTitle]}>{s.title}</Text>
                  <Text style={styles.rowSub}>{s.hint}</Text>
                </View>
                {s.done ? <Text style={styles.doneTag}>{SPACE_KNOWHOW.guideDone}</Text> : null}
              </View>
            ))}
          </View>
          {primary ? (
            <Pressable
              onPress={primary.onPress}
              accessibilityRole="button"
              accessibilityLabel={primary.label}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>{primary.label}</Text>
            </Pressable>
          ) : null}
        </Section>
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

const STEP_DOT = TouchSize.inlineFace - Space.sm;

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: { ...CardStyles.rows },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowText: { flex: 1, gap: Space.xs },
  rowTitle: { ...Type.body, fontWeight: '700' },
  rowSub: { ...Type.desc },
  // 순서 안내 한 줄 = 번호 원 + 제목·설명 + 끝난 단계면 "완료"(색만으로 구분하지 않는다).
  step: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md },
  stepNo: {
    width: STEP_DOT, height: STEP_DOT, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: InkColors.line,
  },
  stepNoNow: { borderColor: InkColors.ink },
  stepNoDone: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  stepNoText: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  stepNoTextNow: { color: InkColors.ink },
  doneTitle: { color: TextColor.secondary },
  doneTag: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  primary: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  small: { ...ButtonStyles.small, flexDirection: 'row', alignItems: 'center', gap: Gap.inline, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  smallText: { ...ButtonTextStyles.small, color: InkColors.ink },
});
