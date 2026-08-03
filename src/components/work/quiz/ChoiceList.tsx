import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors } from '@/lib/theme/colors';
import { qs } from './quizStyles';

/**
 * 선택지 한 벌 — 선택형 8개 형태(mc4·order_pick·value_pick·trap_pick·pair_pick·case_pick·name_pick·chosung)가 공유한다.
 * 규칙 4(즉시 판정): 탭하는 순간 답이 올라간다. 별도 제출 버튼 없음.
 * 정답 표시는 서버 판정(answerIndex)이 내려온 뒤에만 — 클라는 정답을 미리 갖고 있지 않다.
 */
export function ChoiceList({
  choices,
  picked,
  answerIndex,
  disabled,
  onPick,
}: {
  choices: string[];
  picked: number | null;
  /** 서버가 알려준 정답 index. null = 아직 판정 전 */
  answerIndex: number | null;
  disabled: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <View style={qs.wrap}>
      {choices.map((c, i) => {
        const isPicked = picked === i;
        const showRight = answerIndex !== null && answerIndex === i;
        const showWrong = answerIndex !== null && isPicked && answerIndex !== i;
        return (
          <Pressable
            key={i}
            disabled={disabled}
            onPress={() => onPick(i)}
            style={({ pressed }) => [
              qs.choice,
              isPicked && answerIndex === null && qs.choiceOn,
              showRight && qs.choiceRight,
              showWrong && qs.choiceWrong,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={c}
            accessibilityState={{ selected: isPicked, disabled }}
          >
            <Text style={qs.choiceText}>{c}</Text>
            {showRight || showWrong ? (
              <>
                <Ionicons
                  name={showRight ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={showRight ? BrandColors.good : BrandColors.bad}
                />
                {/* 색만으로 상태를 구분하지 않는다 — 라벨 병기 */}
                <Text style={[qs.choiceMark, { color: showRight ? BrandColors.good : BrandColors.bad }]}>
                  {showRight ? '이게 맞아요' : '고른 답'}
                </Text>
              </>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
