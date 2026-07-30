import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { generateQuiz } from '@/lib/ai/client';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import type { QuizInput, QuizQuestion } from '@/lib/ai/types';

type Phase = 'loading' | 'quiz' | 'result' | 'empty' | 'quota';

/**
 * UnderstandingCheckSheet — "이 업무 혼자 할 수 있어요" 자청 시 뜨는 이해 확인 퀴즈(S1 ④).
 * 붙은 노하우로 AI가 객관식 상황문제 2~3개 생성 → 앱이 자동 채점 → 전부 정답이면 통과(사장에게 전달).
 * 자발·페널티 0·재시도 자유·실패는 사장에게 안 감. 알바 화면이라 쿼터 초과 시 요금제 유도 없이 부드럽게.
 */
export function UnderstandingCheckSheet({
  taskText,
  sops,
  onPass,
  onClose,
}: {
  taskText: string;
  sops: QuizInput['sops'];
  onPass: () => void;
  onClose: () => void;
}) {
  // 재시도 = QuizBody 리마운트(key) → 새 문제·초기상태. 이펙트에서 동기 리셋(set-state-in-effect) 회피.
  const [round, setRound] = useState(0);
  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '84%' }}>
      <View style={s.head}>
        <Text style={s.kicker}>이해 확인 · {taskText}</Text>
        <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={20} color={InkColors.ink2} /></Pressable>
      </View>
      <QuizBody key={round} taskText={taskText} sops={sops} onPass={onPass} onClose={onClose} onRetry={() => setRound((r) => r + 1)} />
    </BottomSheet>
  );
}

function QuizBody({
  taskText,
  sops,
  onPass,
  onClose,
  onRetry,
}: {
  taskText: string;
  sops: QuizInput['sops'];
  onPass: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [picks, setPicks] = useState<Record<number, number>>({});

  useEffect(() => {
    let alive = true;
    generateQuiz({ taskText, sops }).then((out) => {
      if (!alive) return;
      if (out.quotaExceeded) { setPhase('quota'); return; }
      if (!out.questions.length) { setPhase('empty'); return; }
      setQuestions(out.questions);
      setPhase('quiz');
    });
    return () => { alive = false; };
  }, [taskText, sops]);

  const allAnswered = questions.length > 0 && questions.every((_, i) => picks[i] !== undefined);
  const correctCount = questions.reduce((n, q, i) => n + (picks[i] === q.answer_index ? 1 : 0), 0);
  const passed = questions.length > 0 && correctCount === questions.length;

  const submit = () => {
    if (!allAnswered) return;
    setPhase('result');
    if (correctCount === questions.length) onPass();
  };
  const retry = () => onRetry();

  return (
    <>
      {phase === 'loading' && (
        <View style={s.center}><ActivityIndicator color={InkColors.ink3} /><Text style={s.centerText}>문제를 만드는 중...</Text></View>
      )}

      {phase === 'quota' && (
        <View style={s.center}>
          <Text style={s.centerEmoji}>🙂</Text>
          <Text style={s.centerText}>이번 달 AI를 많이 썼어요.{'\n'}다음에 다시 해봐요.</Text>
          <Pressable onPress={onClose} style={s.softBtn}><Text style={s.softBtnText}>닫기</Text></Pressable>
        </View>
      )}

      {phase === 'empty' && (
        <View style={s.center}>
          <Text style={s.centerEmoji}>📄</Text>
          <Text style={s.centerText}>아직 확인할 내용이 부족해요.{'\n'}이 업무에 노하우가 더 쌓이면 다시 해봐요.</Text>
          <Pressable onPress={onClose} style={s.softBtn}><Text style={s.softBtnText}>닫기</Text></Pressable>
        </View>
      )}

      {(phase === 'quiz' || phase === 'result') && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
          {phase === 'quiz' && <Text style={s.intro}>붙어 있는 노하우로 만든 상황 문제예요. 편하게 골라보세요 — 틀려도 괜찮고 언제든 다시 할 수 있어요.</Text>}

          {questions.map((q, qi) => {
            const picked = picks[qi];
            const revealed = phase === 'result';
            return (
              <View key={qi} style={s.qBlock}>
                <Text style={s.qAsk}>{qi + 1}. {q.ask}</Text>
                {q.choices.map((c, ci) => {
                  const isPicked = picked === ci;
                  const isAnswer = ci === q.answer_index;
                  const showRight = revealed && isAnswer;
                  const showWrong = revealed && isPicked && !isAnswer;
                  return (
                    <Pressable
                      key={ci}
                      disabled={revealed}
                      onPress={() => setPicks((p) => ({ ...p, [qi]: ci }))}
                      style={[s.choice, isPicked && !revealed && s.choiceOn, showRight && s.choiceRight, showWrong && s.choiceWrong]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isPicked }}
                    >
                      <Ionicons
                        name={showRight ? 'checkmark-circle' : showWrong ? 'close-circle' : isPicked ? 'radio-button-on' : 'radio-button-off'}
                        size={17}
                        color={showRight ? BrandColors.good : showWrong ? BrandColors.bad : isPicked ? InkColors.ink : InkColors.ink3}
                      />
                      <Text style={[s.choiceText, (showRight || (isPicked && !revealed)) && { fontWeight: '800', color: InkColors.ink }]}>{c}</Text>
                    </Pressable>
                  );
                })}
                {revealed && q.explain ? <Text style={s.explain}>{q.explain}</Text> : null}
              </View>
            );
          })}

          {phase === 'result' && (
            <View style={[s.resultBox, passed ? s.resultPass : s.resultFail]}>
              <Ionicons name={passed ? 'ribbon' : 'refresh-circle'} size={22} color={passed ? BrandColors.good : BrandColors.warn} />
              <Text style={s.resultText}>
                {passed ? '이해 확인이 끝났어요. 사장님께 전달됐어요.' : `${questions.length}개 중 ${correctCount}개 맞았어요. 다시 해볼까요?`}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {phase === 'quiz' && (
        <View style={s.foot}>
          <Pressable onPress={submit} disabled={!allAnswered} style={({ pressed }) => [s.cta, !allAnswered && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Text style={s.ctaText}>제출하기</Text>
          </Pressable>
        </View>
      )}
      {phase === 'result' && (
        <View style={s.foot}>
          {passed ? (
            <Pressable onPress={onClose} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}><Text style={s.ctaText}>닫기</Text></Pressable>
          ) : (
            <View style={s.footRow}>
              <Pressable onPress={onClose} style={({ pressed }) => [s.softBtnFlat, pressed && { opacity: 0.7 }]}><Text style={s.softBtnFlatText}>닫기</Text></Pressable>
              <Pressable onPress={retry} style={({ pressed }) => [s.cta, { flex: 1 }, pressed && { opacity: 0.85 }]}><Text style={s.ctaText}>다시 하기</Text></Pressable>
            </View>
          )}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  kicker: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  centerEmoji: { fontSize: 34 },
  centerText: { fontSize: 14, color: InkColors.ink2, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  intro: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600', marginBottom: 14, lineHeight: 18 },

  qBlock: { marginBottom: 18 },
  qAsk: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink, marginBottom: 9, lineHeight: 21 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 7, backgroundColor: InkColors.bg },
  choiceOn: { borderColor: InkColors.ink, backgroundColor: InkColors.cream },
  choiceRight: { borderColor: BrandColors.good, backgroundColor: '#E6F1EA' },
  choiceWrong: { borderColor: BrandColors.bad, backgroundColor: '#FBECEC' },
  choiceText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink2, lineHeight: 19 },
  explain: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 4, paddingHorizontal: 4, lineHeight: 17 },

  resultBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.md, padding: 14, marginTop: 4 },
  resultPass: { backgroundColor: '#E6F1EA' },
  resultFail: { backgroundColor: BrandColors.warnSoft },
  resultText: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  footRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  softBtn: { marginTop: 6, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 22, paddingVertical: 11, backgroundColor: InkColors.bg },
  softBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  softBtnFlat: { justifyContent: 'center', paddingHorizontal: 20, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  softBtnFlatText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
});
