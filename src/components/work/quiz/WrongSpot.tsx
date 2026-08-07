import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors } from '@/lib/theme/colors';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t1 틀린 자리 찾기 — 순서 카드가 나열돼 있고 **하나만 자리가 틀렸다**. 잘못 놓인 카드를 탭.
 * (설계 07-29 §03 T1: "순서가 하나만 뒤바뀐 채로 보여준다. 잘못 놓인 카드를 탭")
 * 백지에서 순서를 만드는 게 아니라 잘못된 걸 알아채는 과제 — 현장에서 필요한 쪽이 이것이다.
 */
export function WrongSpot({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const sequence: string[] = Array.isArray(payload.sequence) ? payload.sequence : [];
  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 고른 자리가 곧 정답.
  const answerIndex = !result ? null : result.correct ? picked : typeof result.answer === 'number' ? result.answer : null;

  return (
    <View style={qs.wrap}>
      {sequence.map((step, i) => {
        const isPicked = picked === i;
        const showRight = answerIndex !== null && answerIndex === i;
        const showWrong = answerIndex !== null && isPicked && answerIndex !== i;
        return (
          <Pressable
            key={i}
            disabled={disabled}
            onPress={() => {
              setPicked(i);
              onAnswer(i);
            }}
            style={({ pressed }) => [
              qs.choice,
              isPicked && answerIndex === null && qs.choiceOn,
              showRight && qs.choiceRight,
              showWrong && qs.choiceWrong,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}번 ${step}`}
            accessibilityState={{ selected: isPicked, disabled }}
          >
            <Text style={qs.badge}>{i + 1}</Text>
            <Text style={qs.choiceText}>{step}</Text>
            {showRight || showWrong ? (
              <>
                <Ionicons
                  name={showRight ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={showRight ? BrandColors.good : BrandColors.bad}
                />
                <Text style={[qs.choiceMark, { color: showRight ? BrandColors.goodText : BrandColors.badText }]}>
                  {showRight ? '여기가 틀린 자리' : '고른 자리'}
                </Text>
              </>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
