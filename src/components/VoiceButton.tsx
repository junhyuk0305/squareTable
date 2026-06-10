import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, TextInput } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';

type Props = {
  onResult: (text: string) => void;
  mockText?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  label?: string;
};

/**
 * 음성 입력 버튼. (프런트 단계: 실제 STT 대신 mockText 반환)
 * size 'lg'(사장님 답변/입력용)에는 '직접 입력' 텍스트 대안을 함께 제공한다.
 * → 음성 미연동 단계에서도 사장님이 본인 답변을 실제로 입력해볼 수 있다.
 */
export function VoiceButton({ onResult, mockText, size = 'md', disabled, label }: Props) {
  const [recording, setRecording] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [draft, setDraft] = useState('');
  const pulse = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sz = SIZES[size];
  const allowText = size === 'lg';

  // 언마운트 시 진행 중인 mock STT 타이머 정리(상태 업데이트 누수 방지)
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.15, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [recording, pulse]);

  function handlePress() {
    if (disabled || recording) return;
    setRecording(true);
    const delay = 1500 + Math.random() * 800;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setRecording(false);
      onResult(mockText ?? '데모 음성 인식 결과 텍스트');
    }, delay);
  }

  function submitText() {
    const v = draft.trim();
    if (!v) return;
    onResult(v);
    setDraft('');
    setTextMode(false);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={handlePress}
        disabled={disabled || recording}
        style={({ pressed }) => [pressed && !recording && { opacity: 0.85 }]}
      >
        <Animated.View
          style={[
            styles.btn,
            {
              width: sz.btn,
              height: sz.btn,
              borderRadius: sz.btn / 2,
              backgroundColor: recording ? BrandColors.warn : BrandColors.brand,
              transform: [{ scale: pulse }],
            },
          ]}
        >
          <Text style={[styles.mic, { fontSize: sz.icon }]}>{recording ? '●' : '🎤'}</Text>
        </Animated.View>
      </Pressable>

      {label && (
        <Text style={[styles.label, { fontSize: sz.label }]}>
          {recording ? '듣고 있어요…' : label}
        </Text>
      )}

      {allowText && !recording && (
        textMode ? (
          <View style={styles.textWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="답변을 직접 입력하세요"
              placeholderTextColor={InkColors.ink3}
              style={styles.input}
              multiline
              autoFocus
            />
            <View style={styles.textRow}>
              <Pressable
                onPress={() => {
                  setTextMode(false);
                  setDraft('');
                }}
                style={({ pressed }) => [styles.textCancelBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.textCancel}>취소</Text>
              </Pressable>
              <Pressable
                onPress={submitText}
                disabled={!draft.trim()}
                style={({ pressed }) => [
                  styles.textSubmitBtn,
                  { opacity: !draft.trim() ? 0.4 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.textSubmit}>등록</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setTextMode(true)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text style={styles.textToggle}>또는 직접 입력</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const SIZES = {
  sm: { btn: 44, icon: 18, label: 12 },
  md: { btn: 72, icon: 28, label: 14 },
  lg: { btn: 120, icon: 44, label: 18 },
} as const;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  mic: { color: '#FFFFFF', fontWeight: '700' },
  label: { color: InkColors.ink3, fontWeight: '600' },

  textToggle: {
    fontSize: 13,
    fontWeight: '700',
    color: InkColors.ink3,
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  textWrap: { width: '100%', gap: 10, marginTop: 4 },
  input: {
    minHeight: 72,
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
  textRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  textCancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  textCancel: { fontSize: 14, fontWeight: '600', color: InkColors.ink3 },
  textSubmitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: BrandColors.brand,
  },
  textSubmit: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
