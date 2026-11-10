import { useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { getSectionMeta } from '@/lib/utils/category';
import { Radius } from '@/lib/theme/elevation';
import { SearchStyles, SEARCH_ICON } from '@/lib/theme/search';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { Space, screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { Screen, Section } from '@/components/Screen';
import { SegmentTabs } from '@/components/SegmentTabs';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { confirmAction } from '@/lib/utils/confirm';
import { suggestionErrorMessage } from '@/lib/suggestion/errors';
import { SUGGESTION_STATUS_CHIP, SUGGESTION_STATUS_LABEL } from '@/lib/suggestion/labels';
import type { PlaybookSuggestion } from '@/types';

/** 제안 본문 최소 글자 — 보낼 때와 고칠 때 같은 기준. */
const MIN_TEXT = 5;

/**
 * 알바 노하우 제안 — ① 새 노하우 등록 신청 / ② 기존 노하우 개선 제안.
 *  · ?entryId=&title= → 개선 모드(대상 노하우 프리셋)
 *  · 없으면 신규/개선 토글 (기본 신규)
 * 제출하면 사장 제안함으로 가고, 사장이 확인 후 반영/반려한다.
 */
export default function JuniorSuggestScreen() {
  const router = useRouter();
  const { entryId, title } = useLocalSearchParams<{ entryId?: string; title?: string }>();
  const presetImprove = typeof entryId === 'string' && entryId.length > 0;

  const submit = useSuggestionStore((s) => s.submit);
  const withdraw = useSuggestionStore((s) => s.withdraw);
  const edit = useSuggestionStore((s) => s.edit);
  const hydrate = useSuggestionStore((s) => s.hydrate);
  const subscribe = useSuggestionStore((s) => s.subscribe);
  const mineFor = useSuggestionStore((s) => s.mineFor);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const suggestionLoaded = useSuggestionStore((s) => s.loaded);
  const userId = useSessionStore((s) => s.userId);
  const entries = usePlaybookStore((s) => s.entries);
  const playbookLoaded = usePlaybookStore((s) => s.loaded);

  const [kind, setKind] = useState<'new' | 'improve'>(presetImprove ? 'improve' : 'new');
  const [text, setText] = useState('');
  // 개선 모드에서 프리셋이 없으면 사용자가 대상 노하우를 직접 고른다.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickQuery, setPickQuery] = useState('');

  useEffect(() => {
    hydrate();
    return subscribe();
  }, [hydrate, subscribe]);

  const mine = useMemo(() => mineFor(userId), [suggestions, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 개선 대상 = 프리셋(다른 화면에서 넘어옴) 우선, 없으면 목록에서 고른 것.
  const picked = useMemo(() => entries.find((e) => e.id === pickedId), [entries, pickedId]);
  const targetEntryId = presetImprove ? entryId : pickedId ?? undefined;
  const targetTitle = presetImprove ? (typeof title === 'string' ? title : undefined) : picked?.title;

  // 검색어로 거른 노하우 목록(개선 대상 선택용).
  const PICK_CAP = 30;
  const { filtered, hiddenPicks } = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    const list = q ? entries.filter((e) => e.title.toLowerCase().includes(q)) : entries;
    // ★조용히 자르지 않는다(2026-08-25 감사 #22). 노하우 100건 매장의 직원은 31번째 이후
    //   노하우에 대한 개선 제안을 **경로 자체가 없어서** 못 올렸다 — 몇 건이 가려졌는지 말하고
    //   검색으로 좁힐 수 있다는 것을 알려준다.
    return { filtered: list.slice(0, PICK_CAP), hiddenPicks: Math.max(0, list.length - PICK_CAP) };
  }, [entries, pickQuery]);

  // 개선 모드인데 대상이 아직 안 정해졌으면 본문 입력 전에 노하우부터 골라야 한다.
  const needsPick = kind === 'improve' && !targetEntryId;
  const canSubmit = text.trim().length >= MIN_TEXT && !needsPick;

  const [sending, setSending] = useState(false);
  // 내가 보낸 대기 제안 고치기 — 그 줄에서 입력칸을 연다. 한 번에 한 줄만.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // ★제안 목록(내가 보낸 제안)과 노하우(개선 대상 목록)가 **둘 다** 와야 그린다.
  //   먼저 그리면 '내가 보낸 제안' 블록이 나중에 툭 나타나고, 개선 모드 목록이 "노하우가 없어요"로 먼저 뜬다.
  const ready = suggestionLoaded && playbookLoaded;

  async function send() {
    if (!canSubmit || sending) return;
    setSending(true);
    // 서버에 실제로 저장됐을 때만 성공 처리 — 실패 시 화면·입력을 유지해 재시도 가능하게(무음 실패 방지).
    const ok = await submit({
      kind,
      text,
      ...(kind === 'improve' && targetEntryId ? { targetEntryId, targetTitle } : null),
    });
    setSending(false);
    if (!ok) {
      showToast('제안 전송에 실패했어요. 다시 시도해 주세요.', 'warn');
      return;
    }
    showToast('제안을 보냈어요 · 사장님이 확인할게요', 'good');
    setText('');
    if (router.canGoBack()) router.back();
  }

  function startEdit(s: PlaybookSuggestion) {
    setEditingId(s.id);
    setEditText(s.text);
  }

  async function saveEdit(id: string) {
    if (editText.trim().length < MIN_TEXT || rowBusy) return;
    setRowBusy(id);
    const err = await edit(id, editText);
    setRowBusy(null);
    if (err) {
      showToast(suggestionErrorMessage(err), 'warn');
      return;
    }
    setEditingId(null);
    showToast('제안을 고쳤어요', 'good');
  }

  async function withdrawOne(id: string) {
    if (rowBusy) return;
    const ok = await confirmAction('제안을 취소할까요?', '사장님 제안함에서 빠져요.', '제안 취소', {
      destructive: true,
      cancelLabel: '그대로 두기',
    });
    if (!ok) return;
    setRowBusy(id);
    const err = await withdraw(id);
    setRowBusy(null);
    if (err) {
      showToast(suggestionErrorMessage(err), 'warn');
      return;
    }
    if (editingId === id) setEditingId(null);
    showToast('제안을 취소했어요', 'good');
  }

  return (
    <Screen scroll={false} tabBar="junior" header={<ScreenTitleHeader title="노하우 제안" backFallback />}>
      <Stack.Screen options={{ title: '노하우 제안' }} />
      {/* 키보드가 입력칸을 가리지 않게 스크롤을 KeyboardShift 안에 직접 둔다 — 여백은 screenScrollStyle 그대로. */}
      <KeyboardShift>
        <ScrollView contentContainerStyle={screenScrollStyle} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {!ready ? (
            <ScreenLoading label="노하우를 불러오고 있어요…" />
          ) : (
            <>
          <Appear delay={stagger(0)}>
          <Text style={styles.lead}>
            더 나은 방법을 알게 됐나요? 사장님께 제안하면, 확인 후 매장 노하우에 반영돼요.
          </Text>
          </Appear>

          {/* 종류 선택 — 개선 프리셋이면 잠금(대상 고정) */}
          {!presetImprove && (
            <Appear delay={stagger(1)}>
            {/* 화면 안 복제 세그먼트 → 공용 SegmentTabs(흰 트랙 + 검정 선택 칸). 바깥 여백은 화면 틀이 정한다. */}
            <SegmentTabs
              style={{ margin: 0 }}
              items={[
                { key: 'new', label: '새 노하우 제안' },
                { key: 'improve', label: '기존 노하우 개선' },
              ]}
              value={kind}
              onChange={(k) => setKind(k as 'new' | 'improve')}
            />
            </Appear>
          )}

          {/* 개선 대상 — 프리셋이거나 목록에서 고른 노하우. 골랐으면 카드로, 아니면 아래 목록에서 선택. */}
          {kind === 'improve' && targetEntryId && (targetTitle || picked) && (
            <Appear delay={stagger(2)}>
            <View style={styles.targetCard}>
              <Ionicons name="create-outline" size={15} color={BrandColors.warnText} />
              <View style={{ flex: 1 }}>
                <Text style={styles.targetLabel}>이 노하우를 개선해요</Text>
                <Text style={styles.targetTitle} numberOfLines={2}>{targetTitle}</Text>
              </View>
              {/* 프리셋이 아니면 다시 고를 수 있게 */}
              {!presetImprove && (
                // 보이는 알약은 낮게, 누르는 상자는 44 이상(RN-web 은 hitSlop 을 무시한다).
                <Pressable onPress={() => setPickedId(null)} hitSlop={8} style={({ pressed }) => [styles.changeHit, pressed && { opacity: 0.6 }]}>
                  <View style={styles.changeBtn}>
                    <Text style={styles.changeText}>변경</Text>
                  </View>
                </Pressable>
              )}
            </View>
            </Appear>
          )}

          {/* 개선할 노하우 고르기 — 개선 모드인데 대상이 아직 없을 때만 */}
          {needsPick && (
            <Appear delay={stagger(2)}>
            <View style={styles.pickWrap}>
              <Text style={styles.fieldLabel}>어떤 노하우를 개선할까요?</Text>
              <View style={SearchStyles.box}>
                <Ionicons name="search" size={SEARCH_ICON.size} color={SEARCH_ICON.color} />
                <TextInput
                  value={pickQuery}
                  onChangeText={setPickQuery}
                  placeholder="노하우 제목 검색"
                  placeholderTextColor={InkColors.ink3}
                  style={SearchStyles.input}
                />
              </View>
              {filtered.length === 0 ? (
                <Text style={styles.pickEmpty}>
                  {entries.length === 0 ? '아직 등록된 노하우가 없어요. 위에서 "새 노하우 제안"으로 보내 주세요.' : '검색 결과가 없어요.'}
                </Text>
              ) : (
                <View style={styles.pickList}>
                  {filtered.map((e, i) => (
                    <Appear key={e.id} delay={stagger(i)}>
                    <Pressable
                      onPress={() => setPickedId(e.id)}
                      style={({ pressed }) => [styles.pickRow, pressed && { backgroundColor: InkColors.bgSoft }]}
                    >
                      <View style={[styles.catDot, { backgroundColor: getSectionMeta(e.section).color }]} />
                      <Text style={styles.pickTitle} numberOfLines={1}>{e.title}</Text>
                      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
                    </Pressable>
                    </Appear>
                  ))}
                  {hiddenPicks > 0 && (
                    <Text style={styles.pickMore}>
                      {hiddenPicks}건이 더 있어요. 위에서 검색해 찾아 주세요.
                    </Text>
                  )}
                </View>
              )}
            </View>
            </Appear>
          )}

          {/* 본문 입력 — 신규이거나, 개선 대상을 정한 뒤에만 노출 */}
          {/* 라벨 ↔ 입력칸 ↔ 안내는 한 묶음이라 섹션 간격(20)이 아니라 붙은 여백 하나(field gap)로 둔다. */}
          {!needsPick && (
              <Appear delay={stagger(2)}>
              <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                {kind === 'improve' ? '어떻게 바꾸면 더 좋을까요?' : '어떤 노하우인가요?'}
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={
                  kind === 'improve'
                    ? '예) 이 단계에서 ~하면 더 빨라요 / 실제로는 ~가 맞아요'
                    : '예) 아이스 음료 픽업대는 30분마다 닦으면 컴플레인이 줄어요'
                }
                placeholderTextColor={InkColors.ink3}
                style={styles.input}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.hint}>구체적으로 적을수록 사장님이 반영하기 쉬워요. (최소 5자)</Text>
              </View>
              </Appear>
          )}

          <Appear delay={stagger(3)}>
          <Pressable onPress={send} disabled={!canSubmit || sending} style={({ pressed }) => [styles.cta, (!canSubmit || sending) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Ionicons name="paper-plane-outline" size={16} color={InkColors.bubbleText} />
            <Text style={styles.ctaText}>{sending ? '보내는 중…' : '사장님께 제안 보내기'}</Text>
          </Pressable>
          </Appear>

          {/* 내 제안 — 데드엔드 방지(보낸 제안의 상태를 본인이 추적) */}
          {mine.length > 0 && (
            <Appear delay={stagger(4)}>
            <Section title="내가 보낸 제안">
              <View style={styles.mineCard}>
              {mine.slice(0, 10).map((s, i) => (
                <View key={s.id} style={i > 0 && styles.mineRowLine}>
                <View style={styles.mineRow}>
                  <View style={[styles.mineChip, { backgroundColor: SUGGESTION_STATUS_CHIP[s.status].bg }]}>
                    <Text style={[styles.mineChipText, { color: SUGGESTION_STATUS_CHIP[s.status].fg }]}>
                      {SUGGESTION_STATUS_LABEL[s.status]}
                    </Text>
                  </View>
                  <Text style={styles.mineText} numberOfLines={1}>{s.text}</Text>
                </View>
                {/* 검토 중인 제안만 고치거나 취소할 수 있다. 사장님이 처리한 뒤엔 서버가 not_pending 으로 막는다. */}
                {s.status === 'pending' && editingId === s.id && (
                  <View style={styles.editWrap}>
                    <TextInput
                      value={editText}
                      onChangeText={setEditText}
                      placeholderTextColor={InkColors.ink3}
                      style={styles.input}
                      multiline
                      textAlignVertical="top"
                      autoFocus
                    />
                    <View style={styles.editBtns}>
                      <Pressable onPress={() => setEditingId(null)} disabled={rowBusy === s.id} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                        <Text style={styles.ghostText}>닫기</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void saveEdit(s.id)}
                        disabled={editText.trim().length < MIN_TEXT || rowBusy === s.id}
                        style={({ pressed }) => [styles.saveBtn, (editText.trim().length < MIN_TEXT || rowBusy === s.id) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={styles.saveText}>{rowBusy === s.id ? '저장하는 중…' : '저장'}</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                {s.status === 'pending' && editingId !== s.id && (
                  <View style={styles.mineActions}>
                    <Pressable onPress={() => startEdit(s)} disabled={rowBusy === s.id} style={({ pressed }) => [ButtonStyles.inlineHit, pressed && { opacity: 0.6 }]}>
                      <Text style={styles.mineActionText}>수정</Text>
                    </Pressable>
                    <Pressable onPress={() => void withdrawOne(s.id)} disabled={rowBusy === s.id} style={({ pressed }) => [ButtonStyles.inlineHit, pressed && { opacity: 0.6 }]}>
                      <Text style={[styles.mineActionText, styles.mineActionDanger]}>제안 취소</Text>
                    </Pressable>
                  </View>
                )}
                </View>
              ))}
              </View>
            </Section>
            </Appear>
          )}
            </>
          )}
        </ScrollView>
      </KeyboardShift>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickMore: { ...Type.desc, paddingVertical: 8, paddingHorizontal: 4 },
  lead: { ...Type.desc },

  // 개선 대상 — 주의 틴트 면(warnSoft) + 글자는 800(warnText). 선 색은 맞는 토큰이 없어 그대로 둔다.
  targetCard: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: '#EAD9B5', borderRadius: Radius.md, padding: Space.md },
  targetLabel: { ...Type.tag, fontWeight: '800', color: BrandColors.warnText },
  targetTitle: { ...Type.body, fontWeight: '700', marginTop: 2 },
  changeHit: { minHeight: 44, justifyContent: 'center' },
  changeBtn: { paddingHorizontal: Space.md, paddingVertical: Space.xs, borderRadius: Radius.pill, backgroundColor: Surface.card, borderWidth: 1, borderColor: '#EAD9B5' },
  changeText: { ...Type.tag, fontWeight: '800', color: BrandColors.warnText },

  pickWrap: { gap: 10 },
  pickEmpty: { ...Type.desc, paddingVertical: 8 },
  // 고르기 목록 = 행 목록 카드(좌우 16은 카드가 든다).
  pickList: { ...CardStyles.rows },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.md, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  catDot: { width: 9, height: 9, borderRadius: 5 },
  pickTitle: { ...Type.body, flex: 1, fontWeight: '600' },

  // 라벨 ↔ 입력칸 ↔ 안내 — 한 묶음 안 여백 하나.
  field: { gap: Space.sm },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: TextColor.secondary },
  // 카드 없이 회색 바탕(Surface.screen)에 바로 놓인 칸 — 흰 면 + 진한 선(lineStrong · 2026-11-02 결정).
  input: { minHeight: 130, borderWidth: 1, borderColor: InkColors.lineStrong, borderRadius: Radius.md, padding: 14, fontSize: 15, color: InkColors.ink, backgroundColor: Surface.input, lineHeight: 22 },
  hint: { ...Type.desc, fontWeight: '600' },

  // 주 버튼 — 그림자 없음(결정표).
  cta: { ...ButtonStyles.primary, flexDirection: 'row', gap: 7, backgroundColor: InkColors.ink, marginTop: 4 },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },

  mineCard: { ...CardStyles.rows },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Space.md },
  mineRowLine: { borderTopWidth: 1, borderTopColor: InkColors.line },
  mineChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.pill },
  mineChipText: { ...Type.tag, fontWeight: '800' },
  mineText: { flex: 1, fontSize: 13, color: TextColor.secondary, fontWeight: '500' },
  // 대기 제안 줄의 글자 버튼(수정·제안 취소) — 누르는 높이 44는 ButtonStyles.inlineHit 가 든다.
  mineActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Space.lg },
  mineActionText: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  mineActionDanger: { color: BrandColors.badText },
  editWrap: { gap: Space.sm, paddingBottom: Space.md },
  editBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: Space.sm },
  ghostBtn: { ...ButtonStyles.small, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { ...ButtonTextStyles.small, color: InkColors.ink },
  saveBtn: { ...ButtonStyles.small, backgroundColor: InkColors.ink },
  saveText: { ...ButtonTextStyles.small, color: InkColors.bubbleText },
});
