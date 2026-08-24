import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t2 더 큰 쪽 고르기 — 값이 다른 **혼동쌍** 둘을 나란히 놓고 큰 쪽을 고른다.
 * (08-24 UI 카탈로그 ⑦ · "레귤러 3펌프 / 라지 4펌프"처럼 비슷한데 값이 다른 쌍 전용)
 *
 * 상황 한 줄(ask)은 시트가 그린다 — 여기는 큰 터치존 둘만 그린다.
 * ★ 선택지가 둘뿐이라 화면 전체가 터치존이 된다. 한 손으로 보지 않고도 누를 수 있는 크기가 목적이라
 *   ChoiceList(한 줄짜리 목록)로 대신하지 않는다.
 */
export function ScalePick({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const choices: string[] = Array.isArray(payload.choices) ? payload.choices : [];
  const unit = typeof payload.unit === 'string' ? payload.unit.trim() : '';
  const [picked, setPicked] = useState<number | null>(null);

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 고른 쪽이 곧 정답.
  const answerIndex: number | null = !result
    ? null
    : result.correct
      ? picked
      : typeof result.answer === 'number'
        ? result.answer
        : null;

  return (
    <View style={qs.wrap}>
      <View style={st.row}>
        {choices.slice(0, 2).map((label, i) => {
          const isPicked = picked === i;
          const showRight = answerIndex !== null && answerIndex === i;
          const showWrong = answerIndex !== null && isPicked && answerIndex !== i;
          return (
            <Pressable
              key={i}
              disabled={disabled || picked !== null}
              onPress={() => {
                setPicked(i);
                onAnswer(i);
              }}
              style={({ pressed }) => [
                st.side,
                isPicked && answerIndex === null && st.sideOn,
                showRight && st.sideRight,
                showWrong && st.sideWrong,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: isPicked, disabled: disabled || picked !== null }}
            >
              <Text style={st.sideText}>{label}</Text>
              {showRight || showWrong ? (
                <Ionicons
                  name={showRight ? 'checkmark-circle' : 'close-circle'}
                  size={20}
                  color={showRight ? BrandColors.good : BrandColors.bad}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {answerIndex === null ? (
        <Text style={qs.hint}>{unit ? `${unit}가 더 많은 쪽을 눌러요` : '더 많은 쪽을 눌러요'}</Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.sm },
  side: {
    flex: 1,
    minHeight: 132,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    backgroundColor: InkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.lg,
  },
  sideOn: { borderColor: InkColors.ink, backgroundColor: InkColors.bgSoft },
  sideRight: { borderColor: BrandColors.good, backgroundColor: '#E6F1EA' },
  sideWrong: { borderColor: BrandColors.bad, backgroundColor: '#FBECEC' },
  sideText: { fontSize: 19, fontWeight: '800', color: InkColors.ink, lineHeight: 27, textAlign: 'center' },
});
