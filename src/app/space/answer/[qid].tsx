import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { KeyboardShift } from '@/components/KeyboardShift';
import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { BottomSheet } from '@/components/BottomSheet';
import { formatRelative } from '@/components/coach/coachUtils';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { fetchEntries, fetchUnknownQueue, replyUnknownQuery, resolveUnknown } from '@/lib/db';
import { placeErrorCode, placeErrorMessage } from '@/lib/place/errors';
import { SPACE_KNOWHOW, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry, UnknownQuery } from '@/types';

const QUEUE = '/space/teach';
/** 보내기 답 글 상한 = 서버 question_replies_body_len(0378 · 1~2000자). */
const BODY_MAX = 2000;

/**
 * S09 공간 답하기(주인) — 질문 하나에 답한다.
 *  · [보내기](Primary) = reply_unknown_query(0378): 질문한 사람에게만 가는 답 글 한 번 · 못 고침 · 노하우·AI 검색에 안 쓴다.
 *    알림은 서버가 보낸다(앱 푸시 notifyUserQuestionAnswered 를 쓰지 않는다).
 *  · [노하우로 남기기](보조) = 쓰기 화면(S07 ?uqId=&seed=)으로 → 정리 → 겹침 확인 → save_unknown_answer(0379).
 *  · [있는 노하우로 답하기](보조) = 공간 노하우 하나를 골라 resolveUnknown(매장과 같은 있는 노하우 길).
 *  버튼 셋은 맨 아래 카드 하나에 모은다(2026-11-17 1차 추천대로). 입력 위 라벨 = "직접 답변".
 * 끝나면 답할 질문(S05)으로 돌아간다. 이미 답한 질문(다른 기기)이면 그 사실만 말하고 돌려보낸다.
 */
export default function SpaceAnswer() {
  const router = useRouter();
  const { qid } = useLocalSearchParams<{ qid: string }>();
  const spaceId = useSessionStore((s) => s.spaceId);
  const userId = useSessionStore((s) => s.userId);

  const [question, setQuestion] = useState<UnknownQuery | null | undefined>(undefined); // undefined = 읽는 중 · null = 없음
  const [entries, setEntries] = useState<PlaybookEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId || !qid) return;
    const [qs, kn] = await Promise.all([fetchUnknownQueue(spaceId), fetchEntries(spaceId)]);
    if (qs.error) {
      setFailed(true);
      return;
    }
    setQuestion(qs.data.find((q) => q.id === qid) ?? null);
    // 노하우를 못 읽어도 보내기는 된다 → 칩의 목록만 빈다(목록 시트가 "남긴 노하우가 없어요"를 말한다).
    setEntries(kn.error ? [] : kn.data.filter((e) => e.status === 'published'));
  }, [spaceId, qid]);

  // 화면에 올 때마다 읽는다(다른 기기에서 먼저 답했으면 바로 "이미 답한 질문"이 되게).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // 다시 시도 — 실패 표시는 여기서만 내린다(effect 안에서 상태를 바로 바꾸지 않는다 · react-hooks/set-state-in-effect).
  const retry = useCallback(() => {
    setFailed(false);
    void load();
  }, [load]);

  const back = useCallback(() => router.dismissTo(QUEUE), [router]);

  const send = useCallback(async () => {
    const text = body.trim();
    if (!qid || !text || busy) return;
    setBusy(true);
    const { error } = await replyUnknownQuery(qid, text);
    setBusy(false);
    if (error) {
      showToast(placeErrorMessage(error), 'warn');
      if (placeErrorCode(error) === 'not_pending') back();
      return;
    }
    showToast(SPACE_KNOWHOW.answerSent, 'good');
    back();
  }, [qid, body, busy, back]);

  const pick = useCallback(
    async (entryId: string) => {
      if (!qid || busy) return;
      setPicking(false);
      setBusy(true);
      const d = await resolveUnknown(qid, entryId, userId ?? undefined, 'existing');
      setBusy(false);
      if (d === 'ok') showToast(SPACE_KNOWHOW.answerPicked, 'good');
      else if (d === 'already') showToast(placeErrorMessage('not_pending'), 'warn');
      else {
        showToast(SPACE_KNOWHOW.saveFail, 'warn');
        return;
      }
      back();
    },
    [qid, userId, busy, back],
  );

  const keep = () => {
    if (!qid) return;
    router.push({ pathname: '/space/write', params: { uqId: qid, ...(body.trim() ? { seed: body.trim() } : null) } });
  };

  const header = <ScreenTitleHeader title={SPACE_KNOWHOW.answerTitle} backFallback={QUEUE} />;

  if (failed && question === undefined) {
    return (
      <Screen header={header}>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadErrorState title={SPACE_KNOWHOW.queueLoadFail} onRetry={retry} />
      </Screen>
    );
  }
  if (question === undefined) {
    return (
      <Screen header={header}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenLoading label={SPACE_KNOWHOW.queueLoading} />
      </Screen>
    );
  }
  if (!question || question.status !== 'pending_owner_answer') {
    return (
      <Screen header={header}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          title={SPACE_KNOWHOW.answeredTitle}
          body={SPACE_KNOWHOW.answeredBody}
          cta={{ label: SPACE_KNOWHOW.backToQueue, onPress: back }}
        />
      </Screen>
    );
  }

  const canSend = !!body.trim() && !busy;

  // 키보드 회피 = 화면 전체(헤더 포함)를 감싼다. Screen 이 스크롤을 품고 있어 그 안에는 둘 수 없다(L-2 와 같은 방식).
  return (
    <KeyboardShift>
    <Screen header={header}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* 폼 꼴(화면조립표 3-4 · 1차 추천대로): 묶음 제목은 카드 밖 · 입력 위 라벨 "직접 답변" · 버튼은 맨 아래 카드 하나. */}
      <Section title={SPACE_KNOWHOW.asked}>
        <View style={styles.card}>
          <Text style={styles.question}>{question.query_text}</Text>
          <Text style={styles.meta}>
            {[question.junior_name || SPACE_WORDS.guest, formatRelative(question.asked_at)].join(', ')}
          </Text>
        </View>
      </Section>

      <Section title={SPACE_WORDS.statDirect}>
        <View style={styles.card}>
          <TextInput
            value={body}
            onChangeText={setBody}
            editable={!busy}
            multiline
            maxLength={BODY_MAX}
            placeholder={SPACE_KNOWHOW.answerPlaceholder}
            placeholderTextColor={TextColor.placeholder}
            style={styles.input}
            accessibilityLabel={SPACE_WORDS.statDirect}
          />
        </View>
      </Section>

      <View style={styles.card}>
        <Text style={styles.meta}>{SPACE_KNOWHOW.answerOnce}</Text>
        <Pressable
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={SPACE_WORDS.answerSend}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed, !canSend && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={InkColors.ink} />
          ) : (
            <Text style={styles.primaryText}>{SPACE_WORDS.answerSend}</Text>
          )}
        </Pressable>
        <View style={styles.pair}>
          <Pressable
            onPress={keep}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={SPACE_WORDS.answerKeep}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{SPACE_WORDS.answerKeep}</Text>
          </Pressable>
          <Pressable
            onPress={() => setPicking(true)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={SPACE_WORDS.answerPick}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{SPACE_WORDS.answerPick}</Text>
          </Pressable>
        </View>
      </View>

      {picking && (
        <BottomSheet visible onClose={() => setPicking(false)} sheetStyle={styles.sheet}>
          <Text style={styles.sheetTitle}>{SPACE_KNOWHOW.pickTitle}</Text>
          {entries.length === 0 ? (
            <Text style={styles.meta}>{SPACE_KNOWHOW.pickEmpty}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.sheetList}>
              {entries.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => void pick(e.id)}
                  accessibilityRole="button"
                  accessibilityLabel={e.title}
                  style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
                >
                  <Text style={styles.pickTitle} numberOfLines={1}>{e.title}</Text>
                  {e.square?.situation ? (
                    <Text style={styles.meta} numberOfLines={1}>{e.square.situation}</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </BottomSheet>
      )}
    </Screen>
    </KeyboardShift>
  );
}

const styles = StyleSheet.create({
  card: { ...CardStyles.list, gap: Space.sm },
  question: { ...Type.body, fontWeight: '700' },
  meta: { ...Type.desc },
  input: {
    ...Type.body,
    minHeight: TouchSize.inline * 3,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    backgroundColor: Surface.input,
  },
  // 주 버튼 = 노랑(10절 7번) · 보조 둘 = 알약(1차 추천대로). 좁은 폭·큰 글자에서는 둘이 아래로 감긴다.
  primary: ButtonStyles.primaryYellow,
  primaryText: ButtonTextStyles.primaryOnYellow,
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  secondary: { ...ButtonStyles.secondary, flexGrow: 1 },
  secondaryText: ButtonTextStyles.secondary,
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
  sheet: { maxHeight: '80%' },
  sheetTitle: { ...Type.section },
  sheetList: { gap: Space.xs },
  pickRow: { minHeight: TouchSize.inline, justifyContent: 'center', paddingVertical: Space.sm, gap: Space.xs },
  pickTitle: { ...Type.body, fontWeight: '700' },
});
