import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ChatComposerBar } from '@/components/ChatComposerBar';
import { UserBubble } from '@/components/UserBubble';
import { SquareCard } from '@/components/SquareCard';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { fetchEntries } from '@/lib/db';
import { track } from '@/lib/analytics/track';
import { notifyAction } from '@/lib/utils/confirm';
import { isServable } from '@/lib/utils/entryStatus';
import { SPACE_SCREEN, SPACE_WORDS, ownerName } from '@/lib/place/words';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Radius } from '@/lib/theme/elevation';
import { Space, Gap } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { ChatQuery, PlaybookEntry } from '@/types';

/** 노하우 쓰기 화면(S07 · ?seed= 입력 미리 채우기). 타입 경로 목록이 다시 만들어지기 전이라 Href 로 둔다. */
const WRITE: Href = '/space/write' as Href;
const HOME: Href = '/space/home';
/** 써 보기 목표 개수(정본 "노하우 3개 써 보기"). */
const WRITE_GOAL = 3;

type Step = 'write' | 'ask' | 'link';
const STEP_NO: Record<Step, number> = { write: 1, ask: 2, link: 3 };

/** 노하우로 답한 턴인가(저장된 답 그대로 · AI 정리). 잡담 응대와 못 찾음은 아니다. */
const answered = (q: ChatQuery) => !!q.response_block?.source && q.response_block.mode !== 'smalltalk';

/**
 * S02 첫 5분(공간 주인) — 공간 만들기(/space/start) 바로 뒤.
 * ① 노하우 3개 써 보기(건너뛰기) → ② 직접 물어보기 → ③ 링크 보내기(입구만) → [끝내기] → 공간 홈.
 *
 * ② 연습 질문은 저장하지 않는다. useChatStore.submit 에 PracticeTarget(공간 번호 + 공간 노하우)을 넘기면
 *   chat_queries 넣기·사용통계·사장 보내기 준비물을 전부 건너뛰고 턴은 practiceHistory 에만 쌓인다.
 *   그래서 미응답에도 홈 숫자에도 안 센다. 못 찾으면 보내기 대신 "노하우 남기기"로 잇는다.
 * ③ 교육 링크는 3번 덩이다. 지금은 안내 한 장과 계측만.
 */
export default function SpaceFirst() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const userName = useSessionStore((s) => s.userName);
  const submit = useChatStore((s) => s.submit);
  const isLoading = useChatStore((s) => s.isLoading);
  const error = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const practiceHistory = useChatStore((s) => s.practiceHistory);

  const [step, setStep] = useState<Step>('write');
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [input, setInput] = useState('');
  // 이 화면에서 물은 턴만 보인다(다시 들어오면 앞 연습이 쏟아지지 않게 · OwnerFirstAsk 와 같은 방법).
  const [mountedAt] = useState(() => new Date().toISOString());
  const turns = useMemo(() => practiceHistory.filter((q) => q.asked_at >= mountedAt), [practiceHistory, mountedAt]);
  const source = SPACE_WORDS.knowhowSource(ownerName(userName));

  // 노하우 쓰기에서 돌아올 때마다 다시 센다(공간 노하우 = 공간 번호로 읽는다 · 매장 스토어를 쓰지 않는다).
  useFocusEffect(
    useCallback(() => {
      if (!spaceId) return;
      let alive = true;
      void fetchEntries(spaceId).then(({ data }) => {
        if (alive) setEntries(data.filter(isServable));
      });
      return () => {
        alive = false;
      };
    }, [spaceId]),
  );

  // 연습 실패 배너가 매장 묻기 화면에 남지 않게 떠날 때 지운다.
  useEffect(() => () => dismissError(), [dismissError]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || isLoading || !spaceId) return;
    setInput('');
    dismissError();
    await submit(q, { unitId: spaceId, entries: entries ?? [] });
    const st = useChatStore.getState();
    if (st.error) return; // 보내지 못한 질문은 세지 않는다
    const last = st.practiceHistory.find((h) => h.id === st.lastSubmittedId);
    if (last) track('space_practice_asked', { found: answered(last) });
  };

  // 못 찾은 질문을 쓰기 화면 입력칸에 미리 넣는다(정본 "이 질문으로 노하우 남기기").
  const keep = (q: ChatQuery) => router.push({ pathname: WRITE as never, params: { seed: q.query_text } });

  const linkEntry = () => {
    track('space_first_link_tapped', {});
    void notifyAction(SPACE_WORDS.link, SPACE_SCREEN.firstLinkSoon, '확인', { icon: 'link-outline' });
  };

  const count = entries?.length ?? 0;
  const title =
    step === 'write' ? SPACE_SCREEN.firstStepWrite : step === 'ask' ? SPACE_SCREEN.firstStepAsk : SPACE_SCREEN.firstStepLink;

  return (
    <Screen header={<ScreenTitleHeader title={SPACE_SCREEN.firstTitle} line={spaceName} backFallback={HOME} />}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.head}>
        <Text style={styles.stepNo}>{SPACE_SCREEN.firstStepOf(STEP_NO[step])}</Text>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      </View>

      {step === 'write' ? (
        <View style={styles.card}>
          <Text style={styles.lead}>{SPACE_SCREEN.firstWriteLead}</Text>
          {entries ? (
            <Text style={styles.count}>{SPACE_SCREEN.firstWriteCount(Math.min(count, WRITE_GOAL))}</Text>
          ) : (
            <ActivityIndicator color={InkColors.ink3} />
          )}
          {count >= WRITE_GOAL ? (
            <PrimaryButton label={SPACE_SCREEN.firstNext} onPress={() => setStep('ask')} />
          ) : (
            <>
              <PrimaryButton label={SPACE_SCREEN.firstWriteDo} onPress={() => router.push(WRITE)} />
              <TextButton label={SPACE_SCREEN.firstSkip} onPress={() => setStep('ask')} />
            </>
          )}
        </View>
      ) : null}

      {step === 'ask' ? (
        <>
          <View style={styles.leadBox}>
            <Text style={styles.lead}>{SPACE_SCREEN.firstAskLead}</Text>
            <Text style={styles.note}>{SPACE_SCREEN.firstAskNote}</Text>
          </View>
          {turns.map((q) => (
            <View key={q.id} style={styles.turn}>
              <UserBubble text={q.query_text} />
              {q.response_block?.mode === 'smalltalk' ? (
                <View style={styles.card}>
                  <Text style={styles.lead}>{q.response_block.summary}</Text>
                </View>
              ) : q.response_block?.source ? (
                <SquareCard
                  summary={q.response_block.summary}
                  actions={q.response_block.actions}
                  donts={q.response_block.donts}
                  source={{
                    entryId: q.response_block.source.entry_id,
                    creatorName: source,
                    title: q.response_block.source.title,
                    version: q.response_block.source.version,
                    updatedAt: q.response_block.source.updated_at,
                  }}
                  category="Event"
                  confidence={q.match_confidence}
                />
              ) : (
                // P7 자리 — 매장은 "사장님께 보내기"지만 연습은 보내지 않는다. 신입이 물으면 알림으로 온다는 것만 알리고 노하우 쓰기로 잇는다.
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Ionicons name="notifications-outline" size={Type.title.fontSize} color={InkColors.ink} />
                    <Text style={styles.notFound}>{SPACE_WORDS.practiceNotFound}</Text>
                  </View>
                  <Pressable
                    onPress={() => keep(q)}
                    accessibilityRole="button"
                    accessibilityLabel={SPACE_WORDS.practiceKeep}
                    style={({ pressed }) => [styles.small, pressed && styles.pressed]}
                  >
                    <Text style={styles.smallText}>{SPACE_WORDS.practiceKeep}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          {isLoading ? (
            <View style={styles.row}>
              <ActivityIndicator color={InkColors.ink3} />
              <Text style={styles.note}>{SPACE_WORDS.searching(ownerName(userName))}</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.err}>{SPACE_SCREEN.firstAskFail}</Text> : null}
          <ChatComposerBar>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={SPACE_WORDS.askPlaceholder}
              placeholderTextColor={TextColor.placeholder}
              returnKeyType="send"
              onSubmitEditing={() => void ask(input)}
              style={styles.input}
              accessibilityLabel={SPACE_WORDS.askPlaceholder}
            />
            <Pressable
              disabled={!input.trim() || isLoading}
              onPress={() => void ask(input)}
              accessibilityRole="button"
              accessibilityLabel={SPACE_SCREEN.firstAskSend}
              style={({ pressed }) => [styles.send, pressed && styles.pressed, (!input.trim() || isLoading) && styles.disabled]}
            >
              <Ionicons name="arrow-up" size={Type.title.fontSize} color={InkColors.bubbleText} />
            </Pressable>
          </ChatComposerBar>
          <PrimaryButton label={SPACE_SCREEN.firstNext} onPress={() => setStep('link')} />
        </>
      ) : null}

      {step === 'link' ? (
        <View style={styles.card}>
          <Text style={styles.lead}>{SPACE_SCREEN.firstLinkLead}</Text>
          <PrimaryButton label={SPACE_SCREEN.firstStepLink} onPress={linkEntry} />
          <TextButton label={SPACE_SCREEN.firstDone} onPress={() => router.replace(HOME)} />
        </View>
      ) : null}
    </Screen>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.textBtn, pressed && styles.pressed]}
    >
      <Text style={styles.textBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { gap: Gap.inline },
  stepNo: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
  title: { ...Type.title },
  card: { ...CardStyles.list, gap: Space.md },
  leadBox: { gap: Gap.inline },
  lead: { ...Type.body },
  note: { ...Type.desc },
  count: { ...Type.numCell, color: InkColors.ink },
  turn: { gap: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  notFound: { ...Type.body, flex: 1, fontWeight: '700' },
  err: { ...Type.desc, color: BrandColors.accentText },
  input: { ...Type.body, flex: 1, minHeight: TouchSize.inline, paddingHorizontal: Space.md, backgroundColor: Surface.card },
  send: {
    width: TouchSize.inline,
    height: TouchSize.inline,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  small: { ...ButtonStyles.small, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: Surface.card },
  smallText: { ...ButtonTextStyles.small, color: InkColors.ink },
  textBtn: { ...ButtonStyles.inlineHit, alignSelf: 'center', paddingHorizontal: Space.lg },
  textBtnText: { ...ButtonTextStyles.small, color: TextColor.secondary },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
