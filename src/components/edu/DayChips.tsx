/**
 * 교육 링크 기간 칩(S10 만들기 · S11 상세가 같이 쓴다). 표시 전용. 고를 수 있는 날과 고른 값은 호출부가 정한다.
 * 칩 모양 = ChipStyles. 누르는 상자 = TouchSize.chip(40 · ui.md 누르는 영역).
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { ChipStyles } from '@/lib/theme/chip';
import { TouchSize } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';

export function DayChips({
  options,
  value,
  onChange,
  disabledOf,
}: {
  options: readonly number[];
  value: number | null;
  onChange: (days: number) => void;
  /** 고를 수 없는 칸(예: 이미 지난 끝 날). */
  disabledOf?: (days: number) => boolean;
}) {
  return (
    <View style={st.row}>
      {options.map((d) => {
        const on = value === d;
        const off = !!disabledOf?.(d);
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            disabled={off}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: off }}
            accessibilityLabel={`${d}일`}
            style={({ pressed }) => [st.hit, off && st.off, pressed && st.pressed]}
          >
            <View style={[ChipStyles.chip, on && ChipStyles.chipOn]}>
              <Text style={[ChipStyles.text, on && ChipStyles.textOn]}>{d}일</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  hit: { minHeight: TouchSize.chip, minWidth: TouchSize.chip, justifyContent: 'center' },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
