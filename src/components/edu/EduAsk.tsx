/**
 * 교육 링크 묻는 칸 + 내 질문(S14 · 0401) — 로그인 없는 웹 /l/[token] 이 쓴다.
 *
 * 흐름(서버가 판정한다 · 이 부품은 부르고 그리기만 한다):
 *  · 처음이면 이름을 적는다. 첫 질문 때 서버가 열쇠를 한 번 준다 → 이 기기에 둔다(guestKey.ts). 다음부터 이름 칸은 없다.
 *  · 질문 보내기 = edu_link_ask → AI 답(엣지 edu_link_answer) → 내 질문을 다시 읽는다(edu_link_answers).
 *  · AI 가 못 찾으면 "보낼까요?" → [보내기]. AI 답이 맞지 않으면 [도움이 안 됐어요]. 둘 다 edu_link_send 하나다.
 *  · 이번 달 AI 를 다 썼으면 서버가 묻는 순간 바로 보낸다 → "이번 달 AI 답은 다 썼어요. {owner}께 바로 보냈어요."
 *  · 보낸 질문의 답은 푸시가 없다. 화면을 다시 열거나 [새 답 확인하기]로 본다(알림사건 1-1).
 * ★토큰·열쇠는 화면 계측·로그에 싣지 않는다. 오류 원문을 화면에 내지 않는다(placeErrorMessage).
 * ★"손님"을 쓰지 않는다. 문구는 place/words.ts(EDU_ASK · SPACE_WORDS) 한 곳.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { KnowhowRows, type KnowhowRow } from '@/components/blocks/KnowhowRows';
import { SectionLabel } from '@/components/SectionLabel';
import { answerEduLinkQuestion } from '@/lib/ai/client';
import { askEduLink, fetchEduLinkAnswers, reportEduLink, sendEduLinkQuestion, type EduAnswer, type EduReportCategory } from '@/lib/db';
import { loadEduGuest, saveEduGuest, type EduGuest } from '@/lib/edu/guestKey';
import { placeErrorMessage } from '@/lib/place/errors';
import { EDU_ASK, SPACE_WORDS, eduOwnerWord, type EduPlace } from '@/lib/place/words';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { ChipStyles } from '@/lib/theme/chip';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { SquareBlock } from '@/types';

/** 서버 묻기 상한과 같은 글자 수(0401 edu_link_ask 1~500자 · 이름 1~20자). */
const TEXT_MAX = 500;
const NAME_MAX = 20;
const REPORT_MIN = 5;
const REPORT_MAX = 1000;

function squareRows(sq: SquareBlock | null): KnowhowRow[] {
  const rows: KnowhowRow[] = [];
  if (!sq) return rows;
  if (sq.situation?.trim()) rows.push({ kind: 'situation', text: sq.situation });
  const steps = (sq.action?.steps ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (steps.length > 0) rows.push({ kind: 'todo', items: steps });
  if (sq.extract?.dont?.trim()) rows.push({ kind: 'dont', text: sq.extract.dont });
  return rows;
}

function aiRows(a: EduAnswer): KnowhowRow[] {
  const b = a.aiBlock;
  if (!b) return [];
  const rows: KnowhowRow[] = [];
  if (b.summary?.trim()) rows.push({ kind: 'summary', text: b.summary });
  const acts = (b.actions ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (acts.length > 0) rows.push({ kind: 'todo', items: acts });
  const donts = (b.donts ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (donts.length > 0) rows.push({ kind: 'dont', text: donts.join('\n') });
  return rows;
}

/**
 * me = 앱 안 링크 화면(S16 · /link/[id])이 넘기는 로그인한 사람의 열쇠(0552 edu_link_me_key · 이름 = 받은 이름).
 *   넘기면 이름 칸이 없고 기기 저장소를 읽거나 쓰지 않는다(계정이 바뀐 기기에 남의 열쇠가 남지 않게). 웹 손님 화면은 넘기지 않는다.
 * focusUq = 답 알림 착지(?uqId= · S16). 그 질문 카드가 그려지면 onFocusCard 로 한 번 알린다(화면이 스크롤한다 · 1112 fix 8).
 *   옛 서버(uq_id 칸 없음)면 맞는 카드가 없어 아무 일도 없다.
 */
export function EduAsk({ token, place, ownerName, me, focusUq, onFocusCard }: {
  token: string; place: EduPlace | null; ownerName: string; me?: EduGuest;
  focusUq?: string; onFocusCard?: (card: View) => void;
}) {
  const owner = eduOwnerWord(place, ownerName);
  const [guest, setGuest] = useState<EduGuest | null>(me ?? null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null); // AI 가 보고 있는 질문 번호
  const [answers, setAnswers] = useState<EduAnswer[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [capNote, setCapNote] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportCat, setReportCat] = useState<EduReportCategory>('ai_answer');
  const [reportBody, setReportBody] = useState('');
  // 착지 카드 — 한 착지에 한 번만 알린다(그 뒤 새로 물어 목록이 밀려도 화면을 다시 끌어당기지 않는다).
  const focusRef = useRef<View>(null);
  const focused = useRef('');

  const refresh = useCallback(async (g: EduGuest | null) => {
    if (!g) return;
    const r = await fetchEduLinkAnswers(token, g.key);
    if (r.error) { setLoadFailed(true); return; }
    setLoadFailed(false);
    setAnswers(r.data ?? []);
  }, [token]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const g = me ?? (await loadEduGuest(token));
      if (!alive || !g) return;
      setGuest(g);
      await refresh(g);
    })();
    return () => { alive = false; };
  }, [token, refresh, me]);

  const sendToOwner = useCallback(async (g: EduGuest, cqId: string, unhelpful: boolean) => {
    setSendingId(cqId);
    const r = await sendEduLinkQuestion(token, g.key, cqId, unhelpful);
    setSendingId(null);
    if (r.error) { showToast(placeErrorMessage(r.error), 'warn'); return; }
    showToast(SPACE_WORDS.askSent(owner), 'good');
    await refresh(g);
  }, [token, owner, refresh]);

  const ask = useCallback(async () => {
    const q = text.trim();
    const nm = (guest?.name ?? name).trim();
    if (!q || !nm || busy) return;
    setBusy(true);
    const r = await askEduLink(token, guest?.key ?? null, nm, q);
    if (r.error || !r.data) {
      setBusy(false);
      showToast(r.error ? placeErrorMessage(r.error, EDU_ASK.askFail) : EDU_ASK.askFail, 'warn');
      return;
    }
    const g: EduGuest = r.data.guestKey ? { key: r.data.guestKey, name: nm } : (guest as EduGuest);
    if (r.data.guestKey && !me) { await saveEduGuest(token, g); setGuest(g); }
    setText('');
    setBusy(false);
    if (r.data.sent) setCapNote(true);
    if (!r.data.aiReady) { await refresh(g); return; }

    setThinking(r.data.cqId);
    await refresh(g);
    const outcome = await answerEduLinkQuestion(token, g.key, r.data.cqId);
    setThinking(null);
    // 엣지가 판정하는 사이 AI 를 다 썼으면 지금 바로 보낸다(서버의 "다 쓰면 바로 보냄"과 같은 결과).
    if (outcome === 'quota') {
      setCapNote(true);
      await sendEduLinkQuestion(token, g.key, r.data.cqId, false);
    }
    await refresh(g);
  }, [text, name, guest, busy, token, refresh, me]);

  const submitReport = useCallback(async () => {
    if (!guest || !reportFor) return;
    const body = reportBody.trim();
    if (body.length < REPORT_MIN) { showToast(placeErrorMessage('invalid_body'), 'warn'); return; }
    const r = await reportEduLink(token, guest.key, reportFor, reportCat, body);
    if (r.error) { showToast(placeErrorMessage(r.error), 'warn'); return; }
    showToast(EDU_ASK.reportDone, 'good');
    setReportFor(null);
    setReportBody('');
  }, [guest, reportFor, reportBody, reportCat, token]);

  const canAsk = !busy && text.trim().length > 0 && (guest ? true : name.trim().length > 0);
  const anyWaiting = answers.some((a) => a.state === 'waiting');

  const renderAnswer = (a: EduAnswer) => {
    const sending = sendingId === a.cqId;
    if (thinking === a.cqId || (a.state === 'asking' && busy)) {
      return (
        <View style={st.row}>
          <ActivityIndicator size="small" color={TextColor.iconMuted} />
          <Text style={st.note}>{SPACE_WORDS.searching(owner)}</Text>
        </View>
      );
    }
    if (a.state === 'ai') {
      return (
        <View style={st.answerBody}>
          <Text style={st.answerLabel}>{EDU_ASK.aiLabel}</Text>
          <KnowhowRows rows={aiRows(a)} />
          {a.aiBlock?.caveat ? <Text style={st.note}>{a.aiBlock.caveat}</Text> : null}
          <View style={st.actions}>
            <Pressable
              onPress={() => guest && void sendToOwner(guest, a.cqId, true)}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={SPACE_WORDS.notHelpful}
              style={({ pressed }) => [st.smallBtn, pressed && st.pressed, sending && st.disabled]}
            >
              <Text style={st.smallText}>{SPACE_WORDS.notHelpful}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setReportFor(reportFor === a.cqId ? null : a.cqId); setReportCat('ai_answer'); }}
              accessibilityRole="button"
              accessibilityLabel={EDU_ASK.report}
              style={({ pressed }) => [st.linkHit, pressed && st.pressed]}
            >
              <Text style={st.linkText}>{EDU_ASK.report}</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    if (a.state === 'none' || a.state === 'asking') {
      return (
        <View style={st.answerBody}>
          <Text style={st.note}>{EDU_ASK.notFoundConfirm(owner)}</Text>
          <Pressable
            onPress={() => guest && void sendToOwner(guest, a.cqId, false)}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel={EDU_ASK.sendToOwner(owner)}
            style={({ pressed }) => [st.smallBtn, pressed && st.pressed, sending && st.disabled]}
          >
            <Text style={st.smallText}>{EDU_ASK.sendToOwner(owner)}</Text>
          </Pressable>
        </View>
      );
    }
    if (a.state === 'waiting') {
      return (
        <View style={st.answerBody}>
          <Text style={st.note}>{SPACE_WORDS.askSent(owner)}. {EDU_ASK.answerHere}</Text>
        </View>
      );
    }
    // answered
    const rows = a.replyBody ? [] : squareRows(a.entrySquare);
    return (
      <View style={st.answerBody}>
        <Text style={st.answerLabel}>{SPACE_WORDS.answeredBy(owner)}</Text>
        {a.replyBody ? <Text style={st.reply}>{a.replyBody}</Text> : null}
        {!a.replyBody && a.entryTitle ? <Text style={st.reply}>{a.entryTitle}</Text> : null}
        {rows.length > 0 ? <KnowhowRows rows={rows} /> : null}
      </View>
    );
  };

  return (
    <View style={st.wrap}>
      {!guest && (
        <View style={st.field}>
          <Text style={st.fieldLabel}>{EDU_ASK.nameLabel}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            editable={!busy}
            placeholder={EDU_ASK.namePlaceholder}
            placeholderTextColor={TextColor.placeholder}
            style={st.input}
            accessibilityLabel={EDU_ASK.nameLabel}
          />
          <Text style={st.note}>{EDU_ASK.nameNote(owner)}</Text>
        </View>
      )}
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
        onPress={() => void ask()}
        disabled={!canAsk}
        accessibilityRole="button"
        accessibilityLabel={EDU_ASK.send}
        style={({ pressed }) => [st.primary, pressed && st.pressed, !canAsk && st.disabled]}
      >
        {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={st.primaryText}>{EDU_ASK.send}</Text>}
      </Pressable>
      {capNote ? <Text style={st.note}>{SPACE_WORDS.aiCapAsker(owner)}</Text> : null}

      {guest && (answers.length > 0 || loadFailed) && (
        <View style={st.section}>
          <SectionLabel title={EDU_ASK.myQuestions} hint={answers.length > 0 ? `${answers.length}개` : undefined} />
          {loadFailed ? <Text style={st.note}>{EDU_ASK.loadFail}</Text> : null}
          {answers.map((a) => (
            <View
              key={a.cqId}
              style={st.card}
              ref={focusUq && a.uqId === focusUq ? focusRef : undefined}
              collapsable={false}
              onLayout={focusUq && a.uqId === focusUq ? () => {
                if (focused.current === focusUq || !focusRef.current) return;
                focused.current = focusUq;
                onFocusCard?.(focusRef.current);
              } : undefined}
            >
              <Text style={st.question}>{a.queryText}</Text>
              {renderAnswer(a)}
              {reportFor === a.cqId && (
                <View style={st.report}>
                  <Text style={st.answerLabel}>{EDU_ASK.reportTitle}</Text>
                  <Text style={st.note}>{EDU_ASK.reportLead}</Text>
                  <View style={st.chips}>
                    {([['ai_answer', EDU_ASK.reportCatAi], ['inappropriate', EDU_ASK.reportCatBad], ['other', EDU_ASK.reportCatOther]] as const).map(([k, label]) => (
                      <Pressable
                        key={k}
                        onPress={() => setReportCat(k)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: reportCat === k }}
                        accessibilityLabel={label}
                        style={st.chipHit}
                      >
                        <View style={[st.chip, reportCat === k && st.chipOn]}>
                          <Text style={[st.chipText, reportCat === k && st.chipTextOn]}>{label}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    value={reportBody}
                    onChangeText={setReportBody}
                    maxLength={REPORT_MAX}
                    multiline
                    placeholder={EDU_ASK.reportPlaceholder}
                    placeholderTextColor={TextColor.placeholder}
                    style={[st.input, st.askInput]}
                    accessibilityLabel={EDU_ASK.reportTitle}
                  />
                  <Pressable
                    onPress={() => void submitReport()}
                    accessibilityRole="button"
                    accessibilityLabel={EDU_ASK.reportSend}
                    style={({ pressed }) => [st.smallBtn, pressed && st.pressed]}
                  >
                    <Text style={st.smallText}>{EDU_ASK.reportSend}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          {anyWaiting && (
            <Pressable
              onPress={() => void refresh(guest)}
              accessibilityRole="button"
              accessibilityLabel={EDU_ASK.refresh}
              style={({ pressed }) => [st.linkHit, st.refresh, pressed && st.pressed]}
            >
              <Ionicons name="refresh" size={Type.desc.fontSize} color={InkColors.ink2} />
              <Text style={st.linkText}>{EDU_ASK.refresh}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: Space.sm },
  field: { gap: Space.xs },
  fieldLabel: { ...Type.desc, fontWeight: '700' },
  // 회색 바탕 위에 카드 없이 놓인 칸 — 흰 면 + lineStrong(ui.md · EduLinkView 자리 칸과 같은 모양).
  input: {
    ...Type.body,
    minHeight: 52,
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
  answerLabel: { ...Type.desc, fontWeight: '700', color: InkColors.ink2 },
  reply: { ...Type.body },
  note: { ...Type.desc },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.md, flexWrap: 'wrap' },
  smallBtn: { ...ButtonStyles.small, minHeight: 48, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: Surface.card },
  smallText: { ...ButtonTextStyles.small, color: InkColors.ink },
  linkHit: { minHeight: 48, justifyContent: 'center' },
  linkText: { ...Type.desc, fontWeight: '700', color: InkColors.ink2 },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, alignSelf: 'flex-start' },
  report: { gap: Space.sm, paddingTop: Space.sm, borderTopWidth: 1, borderTopColor: InkColors.line },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  chipHit: { minHeight: 48, justifyContent: 'center' },
  chip: { ...ChipStyles.chip },
  chipOn: { ...ChipStyles.chipOn },
  chipText: { ...ChipStyles.text },
  chipTextOn: { ...ChipStyles.textOn },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
