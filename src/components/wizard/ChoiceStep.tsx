import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { WizardChoice } from '@/components/WizardChoice';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors } from '@/lib/theme/colors';
import type { ChoiceOption } from '@/lib/wizard/choicePresets';
import type { Category } from '@/types';

type Props = {
  question: string;
  hint?: string;
  options: ChoiceOption[];
  value?: string;
  onSelect: (value: string) => void;
  accentCategory: Category;
  customPlaceholder?: string;
};

/**
 * 위저드 객관식 한 단계 — 업종 프리셋 보기 + '직접 입력' 자유서술을 함께 제공.
 * 선택값이 보기 목록에 없으면 '직접 입력'으로 간주(수정 시 입력칸 복원).
 */
export function ChoiceStep({ question, hint, options, value, onSelect, accentCategory, customPlaceholder }: Props) {
  const accent = getCategoryMeta(accentCategory).color;
  const soft = getCategoryMeta(accentCategory).soft;
  const isPreset = !!value && options.some((o) => o.v === value);
  const [customOpen, setCustomOpen] = useState(!!value && !isPreset);
  const [custom, setCustom] = useState(!isPreset && value ? value : '');

  function pickPreset(v: string) {
    setCustomOpen(false);
    onSelect(v);
  }
  function openCustom() {
    setCustomOpen(true);
    onSelect(custom.trim()); // 빈 값이면 비활성(부모 stepValid에서 막힘)
  }

  return (
    <>
      <Text style={styles.q}>{question}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.choices}>
        {options.map((o) => (
          <WizardChoice
            key={o.v}
            icon={o.icon}
            label={o.v}
            hint={o.hint}
            value={o.v}
            accentCategory={accentCategory}
            selected={!customOpen && value === o.v}
            onSelect={pickPreset}
          />
        ))}

        {/* 직접 입력 */}
        <Pressable
          onPress={openCustom}
          style={({ pressed }) => [
            styles.customCard,
            customOpen && { borderColor: accent, borderWidth: 2, backgroundColor: soft },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.customIcon}>✏️</Text>
          <Text style={[styles.customLabel, customOpen && { color: accent }]}>직접 입력</Text>
        </Pressable>

        {customOpen && (
          <TextInput
            value={custom}
            onChangeText={(t) => {
              setCustom(t);
              onSelect(t.trim());
            }}
            placeholder={customPlaceholder ?? '여기에 직접 적어주세요'}
            placeholderTextColor={InkColors.ink3}
            style={[styles.customInput, { borderColor: accent }]}
            autoFocus
            multiline
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  q: { fontSize: 20, fontWeight: '800', color: InkColors.ink, marginTop: 4 },
  hint: { fontSize: 13, color: InkColors.ink3, marginBottom: 6 },
  choices: { gap: 10 },
  customCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 56,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
    borderStyle: 'dashed',
  },
  customIcon: { fontSize: 22 },
  customLabel: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  customInput: {
    minHeight: 56,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
});
