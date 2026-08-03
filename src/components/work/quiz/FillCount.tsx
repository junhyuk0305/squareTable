import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t2 채워 넣기 — 탭할 때마다 1씩 채워진다. 목표 개수에서 **멈추고** "다 됐어요"로 낸다.
 * (설계 07-29 §03 T2: "컵 그림을 탭할 때마다 시럽이 한 펌프씩. 3번 누르고 멈춰야 한다")
 * 답을 가리키는 게 아니라 실제 행동과 같은 동작이라 손이 기억한다. 멈추는 것까지가 과제.
 * target 은 응시 payload에서 제거돼 있다 — 몇 개가 맞는지는 서버만 안다.
 */
export function FillCount({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const [count, setCount] = useState(0);
  const unit = typeof payload.unit === 'string' ? payload.unit : '개';
  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 채운 개수가 곧 정답.
  const answer = !result ? null : result.correct ? count : typeof result.answer === 'number' ? result.answer : null;

  return (
    <View style={qs.wrap}>
      <View style={st.gauge}>
        <Text style={st.count}>
          {count}
          {unit}
        </Text>
        <View style={st.blocks}>
          {Array.from({ length: count }, (_, i) => (
            <View key={i} style={st.block} />
          ))}
        </View>
      </View>

      {answer !== null ? (
        <Text style={[st.answerLine, { color: result?.correct ? BrandColors.good : BrandColors.bad }]}>
          맞는 개수 · {answer}
          {unit}
        </Text>
      ) : null}

      <Pressable
        disabled={disabled}
        onPress={() => setCount((c) => c + 1)}
        style={({ pressed }) => [qs.btnPrimary, disabled && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="하나 넣기"
      >
        <Text style={qs.btnPrimaryText}>하나 넣기</Text>
      </Pressable>

      <View style={qs.btnRow}>
        <Pressable
          disabled={disabled || count === 0}
          onPress={() => setCount((c) => Math.max(0, c - 1))}
          style={({ pressed }) => [qs.btnSoft, (disabled || count === 0) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="하나 빼기"
        >
          <Text style={qs.btnSoftText}>하나 빼기</Text>
        </Pressable>
        <Pressable
          disabled={disabled || count === 0}
          onPress={() => onAnswer(count)}
          style={({ pressed }) => [qs.btnSoft, (disabled || count === 0) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="다 됐어요"
        >
          <Text style={qs.btnSoftText}>다 됐어요</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  gauge: {
    borderRadius: Radius.lg,
    backgroundColor: InkColors.bgSoft,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
  },
  count: { fontSize: 34, fontWeight: '900', color: InkColors.ink, lineHeight: 44 },
  blocks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.xs, minHeight: 18 },
  block: { width: 18, height: 18, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowDeep },
  answerLine: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
});
