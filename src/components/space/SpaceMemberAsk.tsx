/**
 * S17 멤버 묻기 칸 + 내 질문(사용자 결정 11-11 밤 6 · 결정 146·150 · 계약 6-3).
 *
 * 흐름(판정은 서버·엣지 · 이 부품은 부르고 그리기만 한다):
 *  · 물으면 useSpaceAskStore.ask → 답 있음 = 답 카드 + [도움이 안 됐어요] + "답이 이상하면 신고하기"(/report?unit=<공간>&ai=1).
 *  · 답 없음 = "{owner} 노하우에 아직 없어요. {owner}께 보낼까요?" + [{owner}께 보내기] [보내지 않기].
 *  · AI 를 다 썼으면 확인 없이 바로 보냈다는 문구(SPACE_WORDS.aiCapAsker).
 *  · 내 질문 = space_my_questions(남의 질문은 안 온다 · 결정 150). 답 기다림 / "{owner}이 답했어요" [답 보기].
 *  · focusUq(?uqId=) 가 있으면 그 질문을 펼치고 onFocusY 로 그 자리 y 를 알린다(화면이 스크롤한다 · 착지 N4).
 * ★오류 원문을 화면에 내지 않는다(placeErrorMessage). 문구는 place/words.ts 한 곳.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { KnowhowRows, type KnowhowRow } from '@/components/blocks/KnowhowRows';
import { SectionLabel } from '@/components/SectionLabel';
import { fetchMySpaceQuestions, fetchSpaceMembers, type SpaceMyQuestion } from '@/lib/db';
import { placeErrorMessage } from '@/lib/place/errors';
import { EDU_ASK, SPACE_ASK, SPACE_WORDS, eduOwnerWord } from '@/lib/place/words';
import { useSpaceAskStore, type SpaceAskTurn } from '@/lib/store/useSpaceAskStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry, ResponseBlock, SquareBlock } from '@/types';

/** 서버 보내기 상한(0551 space_question_send 1~2000자)보다 짧게 · 매장 질문 칸과 같은 길이. */
const TEXT_MAX = 500;
/** 누르는 상자 48(계약 0-3 · 터치 48dp). 보이는 모양은 ButtonStyles.small 이 든다. */
const HIT = TouchSize.inline + Space.xs;

function blockRows(b: ResponseBlock | undefined): KnowhowRow[] {
  if (!b) return [];
  const rows: KnowhowRow[] = [];
  if (b.summary?.trim()) rows.push({ kind: 'summary', text: b.summary });
  const acts = (b.actions ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (acts.length > 0) rows.push({ kind: 'todo', items: acts });
  const donts = (b.donts ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (donts.length > 0) rows.push({ kind: 'dont', text: donts.join('\n') });
  return rows;
}

function squareRows(sq: SquareBlock | null): KnowhowRow[] {
  const rows: KnowhowRow[] = [];
  if (!sq) return rows;
  if (sq.situation?.trim()) rows.push({ kind: 'situation', text: sq.situation });
  const steps = (sq.action?.steps ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (steps.length > 0) rows.push({ kind: 'todo', items: steps });
  if (sq.extract?.dont?.trim()) rows.push({ kind: 'dont', text: sq.extract.dont });
  return rows;
}

export function SpaceMemberAsk({
  spaceId,
  entries,
  focusUq,
  onFocusY,
}: {
  spaceId: string;
  /** 그 공간의 노하우(화면이 이미 읽은 것). 비면 AI 를 부르지 않는다. */
  entries: PlaybookEntry[];
  focusUq?: string;
  onFocusY?: (y: number) => void;
}) {
  const router = useRouter();
  const turns = useSpaceAskStore((s) => s.turns);
  const ask = useSpaceAskStore((s) => s.ask);
  const send = useSpaceAskStore((s) => s.send);
  const dismiss = useSpaceAskStore((s) => s.dismiss);
  const me = useSessionStore((s) => s.userId);
  const mine = useMemo(() => turns.filter((t) => t.spaceId === spaceId && t.userId === me), [turns, spaceId, me]);
  const [text, setText] = useState('');
  const [ownerRaw, setOwnerRaw] = useState('');
  const [questions, setQuestions] = useState<SpaceMyQuestion[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState<string>(focusUq ?? '');
  const [listY, setListY] = useState<number | null>(null);
  const [cardY, setCardY] = useState<Record<string, number>>({});
  const owner = eduOwnerWord('space', ownerRaw);
  const busy = mine.some((t) => t.state === 'thinking');

  const refresh = useCallback(async () => {
    const r = await fetchMySpaceQuestions(spaceId);
    if (r.error) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setQuestions(r.data ?? []);
  }, [spaceId]);

  useEffect(() => {
    let alive = true;
    void fetchMySpaceQuestions(spaceId).then((r) => {
      if (!alive) return;
      setLoadFailed(!!r.error);
      if (!r.error) setQuestions(r.data ?? []);
    });
    void fetchSpaceMembers(spaceId).then(({ data }) => {
      if (!alive) return;
      const o = (data ?? []).find((m) => m.role === 'space_owner');
      setOwnerRaw(o?.name ?? '');
    });
    return () => {
      alive = false;
    };
  }, [spaceId]);

  // 착지(?uqId=): 그 질문을 펼친다(같은 화면에 새 착지가 오면 그때도). 자리를 알면 화면에 한 번 알린다.
  const [seenFocus, setSeenFocus] = useState(focusUq ?? '');
  if (focusUq && focusUq !== seenFocus) {
    setSeenFocus(focusUq);
    setOpen(focusUq);
  }
  const focusY = focusUq && listY != null && cardY[focusUq] != null ? listY + cardY[focusUq] : null;
  // 한 착지에 한 번만 옮긴다(그 뒤 새로 물어 목록이 밀려도 화면을 다시 끌어당기지 않는다).
  const focused = useRef('');
  useEffect(() => {
    if (focusY == null || !focusUq || focused.current === focusUq) return;
    focused.current = focusUq;
    onFocusY?.(focusY);
  }, [focusY, focusUq, onFocusY]);

  const submit = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    await ask(spaceId, q, entries);
    // AI 를 다 써서 바로 보냈으면 내 질문에 새 줄이 생긴다(그 밖에는 같은 목록이 다시 온다).
    void refresh();
  };

  const sendTurn = async (t: SpaceAskTurn) => {
    const { error } = await send(t.id);
    if (error) {
      showToast(placeErrorMessage(error, SPACE_ASK.sendFail), 'warn');
      return;
    }
    showToast(SPACE_WORDS.askSent(owner), 'good');
    void refresh();
  };

  const openReport = () => router.push(`/report?unit=${encodeURIComponent(spaceId)}&ai=1` as Href);

  const renderTurn = (t: SpaceAskTurn) => {
    if (t.state === 'thinking') {
      return (
        <View style={st.row}>
          <ActivityIndicator size="small" color={TextColor.iconMuted} />
          <Text style={st.note}>{SPACE_WORDS.searching(owner)}</Text>
        </View>
      );
    }
    if (t.state === 'answer') {
      const served = t.block?.mode === 'served';
      return (
        <View style={st.answerBody}>
          <Text style={st.answerLabel}>{served ? SPACE_ASK.servedFrom(owner) : EDU_ASK.aiLabel}</Text>
          {!served ? <Text style={st.note}>{SPACE_ASK.generatedNote}</Text> : null}
          <KnowhowRows rows={blockRows(t.block)} />
          {t.block?.caveat ? <Text style={st.note}>{t.block.caveat}</Text> : null}
          <View style={st.actions}>
            <Pressable
              onPress={() => void sendTurn(t)}
              accessibilityRole="button"
              accessibilityLabel={SPACE_WORDS.notHelpful}
              style={({ pressed }) => [st.smallHit, pressed && st.pressed]}
            >
              <View style={st.smallBtn}>
                <Text style={st.smallText}>{SPACE_WORDS.notHelpful}</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={openReport}
              accessibilityRole="link"
              accessibilityLabel={SPACE_ASK.reportEntry}
              style={({ pressed }) => [st.linkHit, pressed && st.pressed]}
            >
              <Text style={st.linkText}>{SPACE_ASK.reportEntry}</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    if (t.state === 'ask_owner' || t.state === 'sending') {
      const sending = t.state === 'sending';
      return (
        <View style={st.answerBody}>
          <Text style={st.note}>{EDU_ASK.notFoundConfirm(owner)}</Text>
          <View style={st.actions}>
            <Pressable
              onPress={() => void sendTurn(t)}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={EDU_ASK.sendToOwner(owner)}
              accessibilityState={{ disabled: sending, busy: sending }}
              style={({ pressed }) => [st.smallHit, pressed && st.pressed, sending && st.disabled]}
            >
              <View style={st.smallBtn}>
                {sending ? <ActivityIndicator size="small" color={InkColors.ink} /> : <Text style={st.smallText}>{EDU_ASK.sendToOwner(owner)}</Text>}
              </View>
            </Pressable>
            <Pressable
              onPress={() => dismiss(t.id)}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={SPACE_ASK.keep}
              style={({ pressed }) => [st.linkHit, pressed && st.pressed]}
            >
              <Text style={st.linkText}>{SPACE_ASK.keep}</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <View style={st.answerBody}>
        <Text style={st.note}>{t.capSent ? SPACE_WORDS.aiCapAsker(owner) : SPACE_ASK.sentNote(owner)}</Text>
      </View>
    );
  };

  const renderQuestion = (q: SpaceMyQuestion) => {
    if (q.state === 'waiting') return <Text style={st.note}>{SPACE_ASK.waiting}</Text>;
    const isOpen = open === q.uqId;
    const rows = q.replyBody ? [] : squareRows(q.entrySquare);
    return (
      <View style={st.answerBody}>
        <Pressable
          onPress={() => setOpen(isOpen ? '' : q.uqId)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          accessibilityLabel={isOpen ? SPACE_ASK.answerClose : SPACE_ASK.answerOpen}
          style={({ pressed }) => [st.openRow, pressed && st.pressed]}
        >
          <Text style={st.answerLabel}>{SPACE_WORDS.answeredBy(q.answererName ? eduOwnerWord('space', q.answererName) : owner)}</Text>
          <Text style={st.linkText}>{isOpen ? SPACE_ASK.answerClose : SPACE_ASK.answerOpen}</Text>
        </Pressable>
        {isOpen ? (
          <>
            {q.replyBody ? <Text style={st.reply}>{q.replyBody}</Text> : null}
            {!q.replyBody && q.entryTitle ? <Text style={st.reply}>{q.entryTitle}</Text> : null}
            {rows.length > 0 ? <KnowhowRows rows={rows} /> : null}
          </>
        ) : null}
      </View>
    );
  };

  const canAsk = !busy && text.trim().length > 0;
  const list = questions ?? [];

  return (
    <View style={st.wrap}>
      <TextInput
        value={text}
        onChangeText={setText}
        maxLength={TEXT_MAX}
        editable={!busy}
        multiline
        placeholder={SPACE_WORDS.askPlaceholder}
        placeholderTextColor={TextColor.placeholder}
        style={[st.input, st.askInput]}
        accessibilityLabel={SPACE_WORDS.askPlaceholder}
      />
      <Pressable
        onPress={() => void submit()}
        disabled={!canAsk}
        accessibilityRole="button"
        accessibilityLabel={SPACE_ASK.ask}
        accessibilityState={{ disabled: !canAsk, busy }}
        style={({ pressed }) => [st.primary, pressed && st.pressed, !canAsk && st.disabled]}
      >
        {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={st.primaryText}>{SPACE_ASK.ask}</Text>}
      </Pressable>

      {mine.map((t) => (
        <View key={t.id} style={st.card}>
          <Text style={st.question}>{t.text}</Text>
          {renderTurn(t)}
        </View>
      ))}

      {(list.length > 0 || loadFailed) && (
        <View style={st.section} onLayout={(e) => setListY(e.nativeEvent.layout.y)}>
          <SectionLabel title={EDU_ASK.myQuestions} hint={list.length > 0 ? `${list.length}건` : undefined} />
          {loadFailed ? <Text style={st.note}>{EDU_ASK.loadFail}</Text> : null}
          {list.map((q) => (
            <View
              key={q.uqId}
              style={st.card}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                setCardY((m) => (m[q.uqId] === y ? m : { ...m, [q.uqId]: y }));
              }}
            >
              <Text style={st.question}>{q.queryText}</Text>
              {renderQuestion(q)}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: Space.sm },
  // 회색 바탕 위에 카드 없이 놓인 칸 — 흰 면 + lineStrong(ui.md · EduAsk 와 같은 모양).
  input: {
    ...Type.body,
    borderWidth: 1,
    borderColor: InkColors.lineStrong,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    backgroundColor: Surface.input,
  },
  askInput: { minHeight: TouchSize.inline * 2, textAlignVertical: 'top' },
  primary: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  section: { gap: Space.sm, marginTop: Space.sm },
  card: { ...CardStyles.list, gap: Space.sm },
  question: { ...Type.body, fontWeight: '700' },
  answerBody: { gap: Space.xs },
  answerLabel: { ...Type.desc, fontWeight: '700', color: InkColors.ink2, flexShrink: 1 },
  reply: { ...Type.body },
  note: { ...Type.desc },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: HIT },
  openRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm, minHeight: HIT },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.md, flexWrap: 'wrap' },
  smallHit: { minHeight: HIT, justifyContent: 'center' },
  smallBtn: { ...ButtonStyles.small, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: Surface.card },
  smallText: { ...ButtonTextStyles.small, color: InkColors.ink },
  linkHit: { minHeight: HIT, justifyContent: 'center' },
  linkText: { ...Type.desc, fontWeight: '700', color: InkColors.ink2 },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
