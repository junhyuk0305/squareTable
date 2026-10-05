import { forwardRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors } from '@/lib/theme/colors';

/**
 * 비밀번호 칸 — 눈 아이콘으로 입력한 글자를 보였다 숨겼다 한다(2026-10-05 로그인 화면 표준).
 * 가입 화면은 확인 칸 대신 이 토글로 오타를 확인한다. 나머지 속성은 TextInput 그대로 넘긴다.
 */
export const PasswordInput = forwardRef<TextInput, TextInputProps>(function PasswordInput({ style, ...props }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.wrap}>
      <TextInput ref={ref} {...props} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} style={[style, styles.input]} />
      <Pressable
        onPress={() => setShown((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={shown ? '비밀번호 숨기기' : '비밀번호 보기'}
        style={styles.eye}
      >
        <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={InkColors.ink3} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  input: { paddingRight: 48 },
  eye: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
});
