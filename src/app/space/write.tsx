import { useCallback, useId, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { OwnerCoachChat } from '@/components/OwnerCoachChat';
import { PublishConfirmSheet } from '@/components/owner/PublishConfirmSheet';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { buildDirectUq } from '@/lib/utils/buildEntry';
import { embedEntry } from '@/lib/ai';
import { fetchEntries, fetchUnknownQueue, insertEntry, resolveUnknown, saveUnknownAnswer, updateEntry } from '@/lib/db';
import { placeErrorCode, placeErrorMessage } from '@/lib/place/errors';
import { SPACE_KNOWHOW, SPACE_WORDS } from '@/lib/place/words';
import { Surface } from '@/lib/theme/colors';
import type { PlaybookEntry, SquareBlock, UnknownQuery } from '@/types';

const LIST = '/space/knowhow';
const QUEUE = '/space/teach';

/**
 * S07 공간 노하우 쓰기(주인) — 매장 코치 대화(OwnerCoachChat)를 space 갈래로 쓴다. 세 갈래:
 *  · 새로 쓰기(기본 · ?seed= 입력 미리 채우기) → 저장 → 겹침 확인(PublishConfirmSheet · 파트 칸 없음) → 노하우 넣기 → 앞 화면.
 *  · 고치기(?edit=노하우 번호 · S08) → 말로 고치기 → 저장(updateEntry) → 앞 화면.
 *  · 질문으로 남기기(?uqId= · S09 [노하우로 남기기] · ?seed= = S09 에서 적던 답) → 겹침 확인 → save_unknown_answer(0379 ·
 *    노하우 넣기 + 질문 해결 = 한 트랜잭션 · 답 방식 saved) → 답할 질문(S05). 칩 "이 노하우로 답하기" = resolveUnknown(있는 노하우).
 * ★매장 화면과 섞이지 않게: 매장 스토어(usePlaybookStore · useUnknownQueueStore)를 안 쓴다. 노하우·질문은 공간 번호로 직접 읽고
 *   넣는 행은 unit_id = 공간 번호를 적는다. useUnknownQueueStore 의 앱 푸시(notifyUserQuestionAnswered)도 안 쏜다.
 * ★저장 뒤 색인(embedEntry)은 노하우 자기 자리 번호로 엣지를 부른다(공간이면 엣지 공간 갈래).
 */
export default function SpaceWrite() {
  const router = useRouter();
  const { edit, uqId, seed } = useLocalSearchParams<{ edit?: string; uqId?: string; seed?: string }>();
  const spaceId = useSessionStore((s) => s.spaceId);
  const userId = useSessionStore((s) => s.userId);
  const editId = typeof edit === 'string' && edit ? edit : null;
  const questionId = !editId && typeof uqId === 'string' && uqId ? uqId : null;
  const seedText = typeof seed === 'string' && seed ? seed : undefined;

  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [question, setQuestion] = useState<UnknownQuery | null>(null);
  const [failed, setFailed] = useState(false);

  // 노하우(겹침 확인 재료)와 질문을 공간 번호로 읽는다. 실패면 다시 시도 버튼.
  const load = useCallback(async () => {
    if (!spaceId) return;
    const [kn, qs] = await Promise.all([fetchEntries(spaceId), questionId ? fetchUnknownQueue(spaceId) : Promise.resolve(null)]);
    if (kn.error || qs?.error) {
      setFailed(true);
      return;
    }
    if (qs) setQuestion(qs.data.find((q) => q.id === questionId) ?? null);
    setEntries(kn.data);
  }, [spaceId, questionId]);

  // 화면에 올 때마다 읽는다(겹침 확인에서 "기존 것 고치기"로 갔다 오면 고친 내용이 맞게). 대화 내용은 부품이 들고 있어 안 지워진다.
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

  const editEntry = useMemo(() => (editId && entries ? entries.find((e) => e.id === editId) : undefined), [editId, entries]);
  const answerable = !!question && question.status === 'pending_owner_answer';

  const rid = useId();
  // 코치 대화는 질문 틀(uq)을 받는다. 새로 쓰기·고치기는 합성 질문(buildDirectUq · 저장 칸에는 안 쓰인다).
  const uq = useMemo<UnknownQuery>(() => {
    // 공간 질문의 이름이 비면(링크로 온 사람) 사전 단어로 적는다. 대화 첫 말풍선 꼬리에 쓰인다.
    if (question) return { ...question, junior_name: question.junior_name || SPACE_WORDS.guest };
    if (editEntry) return buildDirectUq(editEntry.category, editEntry.title, `edit_${rid}`);
    return buildDirectUq('Routine', seedText ?? '', `direct_${rid}`);
  }, [question, editEntry, seedText, rid]);

  const leave = useCallback(
    (to: typeof LIST | typeof QUEUE) => {
      if (to === QUEUE) {
        router.dismissTo(QUEUE);
        return;
      }
      if (router.canGoBack()) router.back();
      else router.replace(to);
    },
    [router],
  );

  // ── 저장 전 확인(겹침 · 카테고리). 매장 coach.tsx 와 같은 Promise 모양: null = 취소(코치 대화가 잠금을 푼다). ──
  const [pending, setPending] = useState<{ entries: PlaybookEntry[]; resolve: (section: string | null | undefined) => void } | null>(null);
  const askBeforeSave = useCallback(
    (list: PlaybookEntry[]) => new Promise<string | null | undefined>((resolve) => setPending({ entries: list, resolve })),
    [],
  );
  // 시트가 닫히는 세 길(취소 · 저장 · 기존 고치기)이 전부 여기를 지난다. undefined = 취소.
  const settle = useCallback(
    (section: string | null | undefined) => {
      pending?.resolve(section);
      setPending(null);
    },
    [pending],
  );

  /** 공간 노하우 한 건으로 만든다(자리 = 공간 · 카테고리 = 시트에서 고른 것). buildEntry 가 이미 공간으로 지었어도 한 번 더 못 박는다. */
  const toSpace = useCallback(
    (e: PlaybookEntry, section: string | null): PlaybookEntry => ({ ...e, unit_id: spaceId ?? e.unit_id, section }),
    [spaceId],
  );

  const saveNew = useCallback(
    async (e: PlaybookEntry): Promise<boolean> => {
      const ok = await insertEntry(e);
      if (ok) void embedEntry(e);
      return ok;
    },
    [],
  );

  /** 질문으로 남기기: 노하우 넣기 + 질문 해결 한 번에(0379). not_pending 이면 이미 답한 질문 → 답할 질문으로. */
  const saveAnswer = useCallback(
    async (e: PlaybookEntry): Promise<boolean> => {
      if (!questionId) return false;
      const { data, error } = await saveUnknownAnswer(questionId, e);
      if (error) {
        showToast(placeErrorMessage(error, SPACE_KNOWHOW.saveFail), 'warn');
        if (placeErrorCode(error) === 'not_pending') leave(QUEUE);
        return false;
      }
      void embedEntry({ ...e, id: data ?? e.id });
      return true;
    },
    [questionId, leave],
  );

  const onPublished = useCallback(
    async (entry: PlaybookEntry): Promise<boolean> => {
      const section = await askBeforeSave([entry]);
      if (section === undefined) return false;
      const e = toSpace(entry, section);
      const ok = questionId ? await saveAnswer(e) : await saveNew(e);
      if (!ok) {
        if (!questionId) showToast(SPACE_KNOWHOW.saveFail, 'warn'); // 답 갈래는 saveAnswer 가 서버 문구로 이미 알렸다
        return false;
      }
      showToast(SPACE_KNOWHOW.saved, 'good');
      leave(questionId ? QUEUE : LIST);
      return true;
    },
    [askBeforeSave, toSpace, questionId, saveAnswer, saveNew, leave],
  );

  // 나눠 저장 — 카테고리는 한 번만 묻는다. 질문 갈래면 첫 건이 질문의 답(0379), 나머지는 그냥 넣는다.
  const onPublishedMany = useCallback(
    async (list: PlaybookEntry[]): Promise<boolean[]> => {
      if (list.length === 0) return [];
      const section = await askBeforeSave(list);
      if (section === undefined) return list.map(() => false);
      const results: boolean[] = [];
      for (let i = 0; i < list.length; i++) {
        const e = toSpace(list[i], section);
        results.push(questionId && i === 0 ? await saveAnswer(e) : await saveNew(e));
        if (questionId && i === 0 && !results[0]) return list.map(() => false); // 답이 안 됐으면 나머지도 넣지 않는다
      }
      if (results.every(Boolean)) {
        showToast(SPACE_KNOWHOW.saved, 'good');
        leave(questionId ? QUEUE : LIST);
      } else {
        showToast(SPACE_KNOWHOW.saveFail, 'warn');
      }
      return results;
    },
    [askBeforeSave, toSpace, questionId, saveAnswer, saveNew, leave],
  );

  // 있는 노하우로 답하기(질문 갈래 · 코치 대화의 "비슷한 노하우" 카드). 매장과 같은 resolveUnknown 길이다.
  const answerWithExisting = useCallback(
    async (entryId: string) => {
      if (!questionId) return;
      const d = await resolveUnknown(questionId, entryId, userId ?? undefined);
      if (d === 'ok') showToast(SPACE_KNOWHOW.answerPicked, 'good');
      else if (d === 'already') showToast(placeErrorMessage('not_pending'), 'warn');
      else {
        showToast(SPACE_KNOWHOW.saveFail, 'warn');
        return;
      }
      leave(QUEUE);
    },
    [questionId, userId, leave],
  );

  // 고치기 저장 — 매장 노하우 고치기(owner/edit)와 같은 합치기: 말로 고치는 칸(상황 · 할 일 · 하지 말 것)만 바꾸고 나머지는 둔다.
  const onUpdated = useCallback(
    async (square: SquareBlock, extras: { title: string; keywords: string[] }) => {
      if (!editEntry) return;
      const patch: Partial<PlaybookEntry> = {
        title: extras.title.trim() || editEntry.title,
        square: {
          ...editEntry.square,
          situation: square.situation,
          action: square.action,
          extract: { ...editEntry.square.extract, dont: square.extract.dont },
          ...(square.standard ? { standard: square.standard } : {}),
        },
        search_keywords: extras.keywords.length ? extras.keywords.slice(0, 8) : editEntry.search_keywords,
        version: editEntry.version + 1,
      };
      const ok = await updateEntry(editEntry.id, patch);
      if (!ok) {
        showToast(SPACE_KNOWHOW.saveFail, 'warn');
        return;
      }
      void embedEntry({ ...editEntry, ...patch });
      showToast(SPACE_KNOWHOW.updated, 'good');
      leave(LIST);
    },
    [editEntry, leave],
  );

  const title = editId ? SPACE_KNOWHOW.editTitle : questionId ? SPACE_WORDS.answerKeep : SPACE_KNOWHOW.writeTitle;
  const header = <ScreenTitleHeader title={title} backFallback={questionId ? QUEUE : LIST} />;

  let body;
  if (failed) body = <LoadErrorState title={SPACE_KNOWHOW.loadFail} onRetry={retry} />;
  else if (!entries) body = <ScreenLoading label={SPACE_KNOWHOW.loading} />;
  else if (editId && !editEntry)
    body = (
      <EmptyState
        title={SPACE_KNOWHOW.notFoundTitle}
        body={SPACE_KNOWHOW.notFoundBody}
        cta={{ label: SPACE_KNOWHOW.backToList, onPress: () => router.replace(LIST) }}
      />
    );
  else if (questionId && !answerable)
    body = (
      <EmptyState
        title={SPACE_KNOWHOW.answeredTitle}
        body={SPACE_KNOWHOW.answeredBody}
        cta={{ label: SPACE_KNOWHOW.backToQueue, onPress: () => leave(QUEUE) }}
      />
    );
  else
    body = (
      <>
        <OwnerCoachChat
          uq={uq}
          isInboxAnswer={!!questionId}
          initialCategory={editEntry?.category ?? uq.presumed_category}
          seedText={seedText}
          editEntry={editEntry}
          onUpdated={editEntry ? onUpdated : undefined}
          onPublished={onPublished}
          onPublishedMany={onPublishedMany}
          onAnswerWithExisting={questionId ? answerWithExisting : undefined}
          space={{ id: spaceId ?? '', entries }}
        />
        <PublishConfirmSheet
          visible={!!pending}
          entries={pending?.entries ?? []}
          pool={entries}
          partsEnabled={false}
          onCancel={() => settle(undefined)}
          onConfirm={(section) => settle(section)}
          onEditExisting={(entryId) => {
            settle(undefined); // 저장은 접고 기존 노하우 고치기로 — 같은 노하우가 둘 생기지 않는다.
            router.push({ pathname: '/space/write', params: { edit: entryId } });
          }}
        />
      </>
    );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 채팅 화면이라 입력칸이 아래 안전 영역을 쓴다(매장 coach.tsx 와 같은 틀 · 바탕 Surface.screen).
  container: { flex: 1, backgroundColor: Surface.screen },
});
