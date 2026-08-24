import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t1 순서대로 누르기 — 섞인 항목을 순서대로 탭하면 **탭한 그 자리에** 1·2·3·4 가 붙는다.
 * (08-24 UI 카탈로그 ⑥ · §6-C-3 확정: 스택으로 옮기는 방식이 아니다)
 *
 * ★ 항목이 움직이지 않는다. 누를 때마다 목록이 재배치되면 다음에 누를 것을 눈으로 다시 찾아야 해서
 *   한 손 조작이 깨진다 — 번호 배지만 붙이고 자리는 그대로 둔다.
 * ★ 마지막 항목을 누르는 순간 답이 올라간다. 제출 버튼이 없다(07-29 §04 즉시 판정).
 */
export function OrderBuild({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const items: string[] = Array.isArray(payload.items) ? payload.items : [];
  /** 누른 순서대로의 항목 index. 이게 그대로 응답이 된다. */
  const [picked, setPicked] = useState<number[]>([]);

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 누른 순서가 곧 정답.
  const answerSeq: number[] | null = !result
    ? null
    : result.correct
      ? picked
      : Array.isArray(result.answer)
        ? result.answer.map(Number)
        : null;

  const tap = (i: number) => {
    if (picked.includes(i)) return;
    const next = [...picked, i];
    setPicked(next);
    if (next.length === items.length) onAnswer(next);
  };

  return (
    <View style={qs.wrap}>
      {items.map((text, i) => {
        const pickedAt = picked.indexOf(i);                       // 내가 매긴 번호(0부터)
        const rightAt = answerSeq ? answerSeq.indexOf(i) : -1;    // 맞는 번호(0부터)
        const judged = answerSeq !== null && rightAt >= 0;
        const ok = judged && pickedAt === rightAt;

        return (
          <Pressable
            key={i}
            disabled={disabled || pickedAt >= 0}
            onPress={() => tap(i)}
            style={({ pressed }) => [
              qs.choice,
              pickedAt >= 0 && !judged && qs.choiceOn,
              judged && (ok ? qs.choiceRight : qs.choiceWrong),
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={pickedAt >= 0 ? `${text} · ${pickedAt + 1}번째로 누름` : text}
            accessibilityState={{ selected: pickedAt >= 0, disabled: disabled || pickedAt >= 0 }}
          >
            <Text style={qs.choiceText}>{text}</Text>

            {judged && !ok ? (
              <Text style={st.rightAt}>{rightAt + 1}번째예요</Text>
            ) : null}

            {judged ? (
              <Ionicons
                name={ok ? 'checkmark-circle' : 'close-circle'}
                size={18}
                color={ok ? BrandColors.good : BrandColors.bad}
              />
            ) : null}

            {/* 번호 배지 — 누르기 전에는 빈 칸을 자리만 잡아 둔다(누를 때 줄이 흔들리지 않게). */}
            <View style={[st.mark, pickedAt >= 0 && st.markOn]}>
              <Text style={[st.markText, pickedAt >= 0 && st.markTextOn]}>
                {pickedAt >= 0 ? pickedAt + 1 : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {answerSeq === null ? (
        <Text style={qs.hint}>순서대로 누르면 누른 자리에 번호가 붙어요</Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  mark: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOn: { borderColor: InkColors.ink, backgroundColor: InkColors.ink },
  markText: { fontSize: 13, fontWeight: '900', color: InkColors.ink3 },
  markTextOn: { color: InkColors.bubbleText },
  rightAt: { fontSize: 12, fontWeight: '900', color: BrandColors.badText, marginLeft: Space.xs },
});
