// /reset-password — 재설정 메일 링크가 착지하는 화면(웹). 링크의 토큰으로 세션이 서면(PASSWORD_RECOVERY)
// 루트 _layout 이 여기로 보낸다. 새 비밀번호를 정하면 곧바로 로그인 상태이므로 처음(index)으로 보낸다.
// 링크가 만료됐거나 이미 쓰였으면 세션이 없다 → "다시 요청" 한 가지 행동만 준다(무음 실패 금지).
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { KeyboardShift } from '@/components/KeyboardShift';
import { Wordmark } from '@/components/Wordmark';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { passwordError } from '@/lib/utils/validation';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const changePassword = useSessionStore((s) => s.changePassword);
  const clearPasswordRecovery = useSessionStore((s) => s.clearPasswordRecovery);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const e = passwordError(pw);
    if (e) {
      setErr(e);
      return;
    }
    if (pw !== pw2) {
      setErr('두 비밀번호가 서로 달라요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await changePassword(pw);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    clearPasswordRecovery();
    showToast('비밀번호를 바꿨어요. 이 비밀번호로 로그인돼 있어요.', 'good');
    router.replace('/');
  };

  if (status === 'loading') return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardShift>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Wordmark size="sm" />
          </View>
          {status !== 'signed_in' ? (
            <View style={styles.card} testID="reset-expired">
              <Ionicons name="time-outline" size={28} color={InkColors.ink} />
              <Text style={styles.title}>링크가 만료됐거나 이미 쓰였어요</Text>
              <Text style={styles.text}>재설정 링크는 한 번만 쓸 수 있어요. 새 링크를 다시 받아 주세요.</Text>
              <Pressable onPress={() => router.replace('/forgot-password')} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}>
                <Text style={styles.primaryText}>다시 요청하기</Text>
              </Pressable>
              <Pressable onPress={() => router.replace('/login')} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}>
                <Text style={styles.secondaryText}>로그인으로</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card} testID="reset-form">
              <Text style={styles.title}>새 비밀번호를 정해 주세요</Text>
              <Text style={styles.label}>새 비밀번호</Text>
              <TextInput
                value={pw}
                onChangeText={setPw}
                placeholder="9자 이상"
                placeholderTextColor={InkColors.ink3}
                secureTextEntry
                autoComplete="new-password"
                style={styles.input}
                accessibilityLabel="새 비밀번호"
                testID="reset-pw"
              />
              <Text style={styles.label}>한 번 더</Text>
              <TextInput
                value={pw2}
                onChangeText={setPw2}
                placeholder="같은 비밀번호"
                placeholderTextColor={InkColors.ink3}
                secureTextEntry
                autoComplete="new-password"
                style={styles.input}
                onSubmitEditing={() => void submit()}
                accessibilityLabel="새 비밀번호 확인"
                testID="reset-pw2"
              />
              {err ? <Text style={styles.err}>{err}</Text> : null}
              <Pressable disabled={busy} onPress={() => void submit()} accessibilityRole="button" testID="reset-submit" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>비밀번호 바꾸기</Text>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardShift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  body: { flexGrow: 1, padding: Space.xl, justifyContent: 'center', gap: Space.xl },
  header: { alignItems: 'center' },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line, padding: Space.gutter, gap: Space.sm, alignItems: 'stretch' },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  text: { fontSize: 14, lineHeight: 21, color: InkColors.ink2 },
  label: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2, marginTop: Space.sm },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, height: 46, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.bg },
  err: { fontSize: 12.5, color: BrandColors.badText },
  primary: { marginTop: Space.sm, minHeight: 50, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2, textDecorationLine: 'underline' },
});
