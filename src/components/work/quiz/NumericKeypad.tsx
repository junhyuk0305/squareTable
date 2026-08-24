import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { NUMERIC_MAX } from '@/lib/quiz/formats/numericEntry';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t2 숫자로 답하기 — 텐키로 값을 직접 친다(08-24 UI 카탈로그 ⑬).
 *
 * 채워 넣기(FillCount)와 나누는 기준은 값의 크기다 — 저쪽은 1~12 를 탭으로 올리고,
 * 이쪽은 온도(62도)·시간(90분)처럼 탭으로 못 올리는 값을 친다. 보기가 없어 찍기가 안 통한다.
 *
 * ★ 단위는 응시 payload 에 남아 **표시만** 된다(입력은 숫자만). "몇 도인가"를 묻는데 단위를
 *   감추면 문제가 성립하지 않는다 — 정답 키가 아니라서 서버 strip 대상이 아니다.
 */

/** 자릿수 상한 — 형태 파일의 NUMERIC_MAX(999)와 같아야 한다. */
const MAX_DIGITS = String(NUMERIC_MAX).length;

export function NumericKeypad({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const [val, setVal] = useState('');
  const unit = typeof payload.unit === 'string' ? payload.unit : '';

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 친 값이 곧 정답.
  const answer = !result
    ? null
    : result.correct
      ? Number(val)
      : typeof result.answer === 'number'
        ? result.answer
        : null;

  const digit = (d: string) => {
    // 앞자리 0 은 값이 되지 않는다("062") — 아예 안 받는다.
    if (!val && d === '0') return;
    if (val.length >= MAX_DIGITS) return;
    setVal(val + d);
  };

  const keys: { label: string; onPress: () => void; wide?: boolean }[] = [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => ({ label: d, onPress: () => digit(d) })),
    { label: '지우기', onPress: () => setVal(''), wide: true },
    { label: '0', onPress: () => digit('0') },
    { label: '확인', onPress: () => onAnswer(Number(val)), wide: true },
  ];

  return (
    <View style={qs.wrap}>
      <View style={st.display}>
        <Text
          style={[
            st.value,
            result ? { color: result.correct ? BrandColors.goodText : BrandColors.badText } : null,
          ]}
        >
          {val || '_'}
          {unit}
        </Text>
      </View>

      {answer !== null && !result?.correct ? (
        <Text style={st.answerLine}>
          맞는 값 · {answer}
          {unit}
        </Text>
      ) : null}

      <View style={st.keypad}>
        {keys.map((k) => {
          // 값이 없으면 확인·지우기는 할 일이 없다 — 눌러도 아무 일이 없는 버튼을 살려 두지 않는다.
          const off = disabled || ((k.label === '확인' || k.label === '지우기') && !val);
          return (
            <Pressable
              key={k.label}
              disabled={off}
              onPress={k.onPress}
              style={({ pressed }) => [
                st.key,
                k.label === '확인' && st.keyConfirm,
                off && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={k.label}
              accessibilityState={{ disabled: off }}
            >
              <Text style={[st.keyText, k.label === '확인' && st.keyConfirmText]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {!result ? <Text style={qs.hint}>숫자를 누르고 확인을 눌러요</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  display: {
    borderRadius: Radius.lg,
    backgroundColor: InkColors.bgSoft,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { fontSize: 34, fontWeight: '900', color: InkColors.ink, lineHeight: 44, letterSpacing: 2 },
  answerLine: { fontSize: 15, fontWeight: '800', color: BrandColors.badText, textAlign: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  key: {
    width: '31%',
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
  },
  keyText: { fontSize: 20, fontWeight: '800', color: InkColors.ink },
  keyConfirm: { borderColor: InkColors.ink, backgroundColor: InkColors.ink },
  keyConfirmText: { fontSize: 16, color: InkColors.bubbleText },
});
