import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';

type Props = {
  onResult: (text: string) => void;
  /** @deprecated 음성 단계에서 쓰던 더미 텍스트. 텍스트 입력 단계에서는 무시됨. */
  mockText?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  label?: string;
};

/**
 * 답변 입력 컴포넌트.
 *
 * ⚠️ 음성 입력은 현재 제거된 상태로, 텍스트 직접 입력으로만 동작한다.
 * (원복하려면 git 히스토리의 음성 버전 VoiceButton 참고)
 * 기존 호출부 호환을 위해 컴포넌트명/props(onResult·label·size·disabled)는 그대로 유지한다.
 */
export function VoiceButton({ onResult, size = 'md', disabled, label }: Props) {
  const [draft, setDraft] = useState('');
  const big = size === 'lg';

  function submit() {
    const v = draft.trim();
    if (!v) return;
    onResult(v);
  }

  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="여기에 입력하세요"
        placeholderTextColor={InkColors.ink3}
        style={[styles.input, big && styles.inputBig]}
        editable={!disabled}
        multiline
      />
      <Pressable
        onPress={submit}
        disabled={disabled || !draft.trim()}
        style={({ pressed }) => [
          styles.btn,
          { opacity: disabled || !draft.trim() ? 0.4 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.btnText}>입력</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  inputBig: { minHeight: 96, fontSize: 16 },
  btn: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: BrandColors.brand,
  },
  btnText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
