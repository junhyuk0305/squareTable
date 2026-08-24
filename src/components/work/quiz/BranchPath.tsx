import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { parseBranchNext } from '@/lib/quiz/formats/branchPath';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

type Step = { ask?: string; yes?: string; no?: string };

const YES = 0;
const NO = 1;

/**
 * t5 갈래 따라가기 — 조건이 단계적으로 갈린다. 예/아니요를 고를 때마다 지나온 길이 위로 쌓이고,
 * 갈래 끝에 닿으면 결과 카드가 뜬다. (08-24 UI 카탈로그 ⑧)
 *
 * case_pick 은 결론 하나를 4개 중에 고르게 한다. 이쪽은 **결론에 이르는 판단 과정**을 묻는다 —
 * 그래서 채점도 도착한 결과가 아니라 밟아 온 경로로 한다(formats/branchPath.ts 주석).
 *
 * ★ 지나온 길을 지우지 않는다. 매 단계가 독립 문제처럼 보이면 "조건이 이어진다"는 이 형태의
 *   유일한 배울 거리가 사라진다.
 */
export function BranchPath({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const steps: Step[] = Array.isArray(payload.steps) ? payload.steps : [];
  const results: string[] = Array.isArray(payload.results) ? payload.results : [];

  const [at, setAt] = useState(0);
  const [trail, setTrail] = useState<{ step: number; pick: number }[]>([]);
  const [landed, setLanded] = useState<number | null>(null);

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 밟은 경로가 곧 정답.
  const answerPath: number[] | null = !result
    ? null
    : result.correct
      ? trail.map((t) => t.pick)
      : Array.isArray(result.answer)
        ? result.answer.map(Number)
        : null;

  /**
   * 갈린 지점. 여기서부터는 서로 다른 갈래를 걷고 있어서 이후 단계를 맞다/틀리다로 견줄 수 없다
   * — 그래서 갈린 한 줄에만 표시하고 그 아래는 표시를 비운다.
   */
  const divergeAt = !answerPath
    ? -1
    : trail.findIndex((t, k) => answerPath[k] !== t.pick);

  const choose = (pick: number) => {
    const next = parseBranchNext(pick === YES ? steps[at]?.yes : steps[at]?.no);
    if (!next) return;                                   // 검증을 통과한 문항엔 없는 경우
    const nextTrail = [...trail, { step: at, pick }];
    setTrail(nextTrail);
    if (next.kind === 'r') {
      setLanded(next.i);
      onAnswer(nextTrail.map((t) => t.pick));
    } else {
      setAt(next.i);
    }
  };

  const current = landed === null ? steps[at] : null;

  return (
    <View style={qs.wrap}>
      {trail.map((t, k) => {
        const judged = answerPath !== null && divergeAt >= 0 && k <= divergeAt;
        const ok = judged && k < divergeAt;
        return (
          <View key={k} style={[st.past, judged && (ok ? st.pastRight : st.pastWrong)]}>
            <Ionicons
              name={!judged || ok ? 'checkmark-circle' : 'close-circle'}
              size={17}
              color={!judged ? InkColors.ink3 : ok ? BrandColors.good : BrandColors.bad}
            />
            <View style={st.pastText}>
              <Text style={st.pastAsk}>{steps[t.step]?.ask ?? ''}</Text>
              <Text style={st.pastAnswer}>
                {t.pick === YES ? '예' : '아니요'}
                {judged && !ok ? ` · ${answerPath![k] === YES ? '예' : '아니요'}였어요` : ''}
              </Text>
            </View>
          </View>
        );
      })}

      {current ? (
        <>
          <View style={qs.prelude}>
            <Text style={qs.preludeText}>{current.ask ?? ''}</Text>
          </View>
          <View style={qs.btnRow}>
            <Pressable
              disabled={disabled}
              onPress={() => choose(YES)}
              style={({ pressed }) => [qs.btnSoft, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="예"
            >
              <Text style={qs.btnSoftText}>예</Text>
            </Pressable>
            <Pressable
              disabled={disabled}
              onPress={() => choose(NO)}
              style={({ pressed }) => [qs.btnSoft, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="아니요"
            >
              <Text style={qs.btnSoftText}>아니요</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {landed !== null ? (
        <View style={st.result}>
          <Text style={st.resultText}>{results[landed] ?? ''}</Text>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  past: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 52,
  },
  pastRight: { backgroundColor: '#E6F1EA' },
  pastWrong: { backgroundColor: '#FBECEC' },
  pastText: { flex: 1, minWidth: 0, gap: 2 },
  pastAsk: { fontSize: 15, fontWeight: '700', color: InkColors.ink2, lineHeight: 22 },
  pastAnswer: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  result: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.ink,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { fontSize: 17, fontWeight: '800', color: InkColors.ink, lineHeight: 25, textAlign: 'center' },
});
