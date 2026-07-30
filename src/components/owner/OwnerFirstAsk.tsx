// OwnerFirstAsk — 사장 온보딩 aha 스텝(콜드스타트 슬라이스 A): "지금 제일 헷갈리는 것 하나 물어보세요".
//
// 목적: aha(첫 가치)를 다인 루프에서 떼어내 1인·첫 세션 안에서 완결한다(TTV 3분).
//   방금 담은 업종팩 노하우가 실제로 어떻게 답이 되는지 사장이 직접 확인하는 화면.
// 재사용: 답변 파이프는 useChatStore.submit 그대로(triage·coverage·grounding 판정 SSOT 유지),
//   서빙 턴 렌더는 ChatTurn 그대로. 신규는 입력·추천칩·사장 문맥 미매칭 카드뿐.
// 미매칭(deflect) 턴은 junior 카피("사장님께 등록") 대신 사장 문맥 카드를 렌더 —
//   "직원이 물으면 이렇게 사장님께 도착해요"를 보여주고 registerToOwner(기존 파이프)로
//   받은질문에 담아 캡처 루프의 첫 경험으로 반전시킨다.
import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ChatTurn } from '@/components/junior/ChatTurn';
import { UserBubble } from '@/components/UserBubble';
import { Appear } from '@/components/Appear';
import { PressableScale } from '@/components/PressableScale';
import { useChatStore } from '@/lib/store/useChatStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { isServable } from '@/lib/utils/entryStatus';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER, CONTENT_MAX_WIDTH, frameCapStyle } from '@/lib/theme/layout';
import type { Category } from '@/types';

export function OwnerFirstAsk({ onNext, nextLabel }: { onNext: () => void; nextLabel: string }) {
  const history = useChatStore((s) => s.history);
  const isLoading = useChatStore((s) => s.isLoading);
  const error = useChatStore((s) => s.error);
  const submit = useChatStore((s) => s.submit);
  const retryLast = useChatStore((s) => s.retryLast);
  const rate = useChatStore((s) => s.rate);
  const registerToOwner = useChatStore((s) => s.registerToOwner);
  const deflectStatus = useChatStore((s) => s.deflectStatus);
  const lastSubmittedId = useChatStore((s) => s.lastSubmittedId);
  const getEntryById = usePlaybookStore((s) => s.getById);
  const entries = usePlaybookStore((s) => s.entries);
  const unknownQueue = useUnknownQueueStore((s) => s.queue);

  const [input, setInput] = useState('');
  // 이 스텝에서 새로 물은 턴만 보여준다 — 재진입 시 과거 기록 전체가 쏟아지는 것 방지.
  // (ref 는 렌더 중 접근 금지 린트에 걸린다 — 마운트 시각은 state 초기화로 1회 고정)
  const [mountedAt] = useState(() => new Date().toISOString());
  const turns = useMemo(() => history.filter((h) => h.asked_at >= mountedAt), [history, mountedAt]);

  // 추천 칩 = 방금 담은 노하우 제목 — 탭하면 그대로 질문(SERVE 확률 최대 = 첫 경험을 성공으로).
  const suggestions = useMemo(
    () => entries.filter(isServable).slice(0, 3).map((e) => e.title),
    [entries],
  );

  const canSend = !!input.trim() && !isLoading;
  const send = (text: string) => {
    if (!text.trim() || isLoading) return;
    setInput('');
    void submit(text.trim());
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Appear delay={0} style={styles.intro}>
          <Text style={styles.introTitle}>방금 담은 노하우로{'\n'}어떻게 답하는지 확인해 보세요</Text>
          <Text style={styles.introBody}>
            지금 제일 헷갈리는 것 하나를 물어봐 주세요. 직원이 물으면 이 답을 그대로 받아요.
          </Text>
        </Appear>

        {turns.length === 0 && suggestions.length > 0 && (
          <Appear delay={60} style={styles.chipWrap}>
            {suggestions.map((t) => (
              <Pressable
                key={t}
                onPress={() => send(t)}
                disabled={isLoading}
                style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`추천 질문: ${t}`}
              >
                <Text style={styles.chipText} numberOfLines={1}>{t}</Text>
              </Pressable>
            ))}
          </Appear>
        )}

        {turns.map((q) =>
          q.response_block ? (
            <ChatTurn
              key={q.id}
              query={q}
              animateIn={q.id === lastSubmittedId}
              onThumbsUp={() => rate(q.id, 'up')}
              onThumbsDown={() => rate(q.id, 'down')}
              // 서빙 턴에서만 ChatTurn을 쓰므로 deflect 계열 프롭은 도달하지 않는다(미매칭은 아래 카드).
              deflectState="registered"
              onRegister={() => {}}
              onDecline={() => {}}
              resolveCategory={(entryId) => (getEntryById(entryId)?.category as Category) ?? 'Event'}
              findUQ={(queryText) => unknownQueue.find((u) => u.query_text === queryText)}
            />
          ) : (
            <View key={q.id} style={styles.turn}>
              <UserBubble text={q.query_text} />
              <View style={styles.deflectCard}>
                <Text style={styles.deflectTitle}>아직 이 내용의 노하우가 없어요</Text>
                <Text style={styles.deflectBody}>
                  직원이 물으면 이렇게 사장님께 질문이 도착해요. 사장님이 한 번 답하면 다음부터는 AI가 대신 답해요.
                </Text>
                {deflectStatus[q.id] === 'registered' ? (
                  <Text style={styles.deflectDoneText}>받은질문에 담아뒀어요. 답을 만들면 노하우가 돼요.</Text>
                ) : (
                  <Pressable
                    onPress={() => registerToOwner(q.id)}
                    style={({ pressed }) => [styles.deflectBtn, pressed && { opacity: 0.9 }]}
                    accessibilityRole="button"
                    accessibilityLabel="받은질문에 담아두기"
                  >
                    <Ionicons name="download-outline" size={15} color={InkColors.ink} />
                    <Text style={styles.deflectBtnText}>받은질문에 담아두기</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ),
        )}

        {isLoading && (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>담아둔 노하우를 찾아보는 중…</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void retryLast()} hitSlop={8}>
              <Text style={styles.errorRetry}>다시 시도</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* 하단: 입력줄 + 다음/건너뛰기 — 질문은 권유지 강요가 아니다(건너뛰기 상시). */}
      <View style={styles.barWrap}>
        <View style={[styles.bar, frameCapStyle]}>
        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="예: 마감 청소 어디까지 해요?"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            editable={!isLoading}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            accessibilityLabel="질문 입력"
          />
          <Pressable
            onPress={() => send(input)}
            disabled={!canSend}
            style={[styles.sendBtn, !canSend && styles.sendBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="질문 보내기"
          >
            <Ionicons name="arrow-up" size={18} color={canSend ? InkColors.bubbleText : InkColors.ink3} />
          </Pressable>
        </View>
        {/* 버튼명 "다음" 금지(워딩 §3) — 목적지를 밝힌 라벨(nextLabel)을 호출부가 넘긴다. */}
        {turns.length > 0 ? (
          <PressableScale onPress={onNext} scaleTo={0.98} style={styles.nextBtn} accessibilityRole="button" accessibilityLabel={nextLabel}>
            <Text style={styles.nextText}>{nextLabel}</Text>
          </PressableScale>
        ) : (
          <Pressable onPress={onNext} hitSlop={8} style={styles.skip} accessibilityRole="button" accessibilityLabel="건너뛰기">
            <Text style={styles.skipText}>나중에 물어볼게요</Text>
          </Pressable>
        )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: SCREEN_GUTTER,
    paddingTop: Space.lg,
    gap: Space.lg,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
  },
  intro: { gap: Space.sm, paddingTop: Space.sm },
  introTitle: { fontSize: 24, fontWeight: '900', color: InkColors.ink, lineHeight: 32 },
  introBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },

  chipWrap: { gap: Space.sm },
  chip: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    ...Elevation.e1,
  },
  chipText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink },

  turn: { gap: Space.md },
  deflectCard: {
    backgroundColor: BrandColors.yellowSoft,
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.sm,
    ...Elevation.e1,
  },
  deflectTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  deflectBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  deflectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    marginTop: Space.xs,
  },
  deflectBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  deflectDoneText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2, marginTop: Space.xs },

  loading: { paddingVertical: Space.md, alignItems: 'center' },
  loadingText: { fontSize: 13.5, color: InkColors.ink3 },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: BrandColors.warnSoft,
    borderWidth: 1,
    borderColor: BrandColors.warnBorder,
    borderRadius: Radius.md,
    padding: Space.md,
  },
  errorText: { flex: 1, fontSize: 13.5, color: InkColors.ink2, lineHeight: 19 },
  errorRetry: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },

  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    backgroundColor: InkColors.bg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
    gap: Space.sm,
    ...Elevation.e2,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  input: {
    flex: 1,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    fontSize: 15,
    color: InkColors.ink,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: InkColors.line },
  nextBtn: {
    backgroundColor: InkColors.ink,
    paddingVertical: Space.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    ...Elevation.e2,
  },
  nextText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
  skip: { alignSelf: 'center', paddingVertical: Space.sm, paddingHorizontal: Space.lg },
  skipText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
});
