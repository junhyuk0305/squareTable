// /forgot-password — 비밀번호 찾기(2026-09-23 사용자 결정: 앱·웹 모든 곳에서). 이메일로 재설정 링크를 보낸다.
//
// 원칙(OWASP): 가입 여부를 문장으로 드러내지 않는다 — 어떤 이메일이든 "보냈어요" 한 가지. 링크는 1회용이고
// 60초 안에는 다시 못 보낸다(버튼이 스스로 잠긴다). 링크는 웹에서 열려 `/reset-password` 가 받는다.
// 이메일을 모르는 사람은 전화 인증으로 찾는 길이 아직 없다 — 아래 한 줄로 문의를 안내한다.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { KeyboardShift } from '@/components/KeyboardShift';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { isValidEmail } from '@/lib/utils/validation';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const RESEND_SECONDS = 60;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const sendPasswordReset = useSessionStore((s) => s.sendPasswordReset);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    const e = email.trim();
    if (!isValidEmail(e)) {
      setErr('이메일 형식을 확인해 주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await sendPasswordReset(e);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    setSent(true);
    setCooldown(RESEND_SECONDS);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenTitleHeader title="비밀번호 찾기" backFallback="/login" />
      <KeyboardShift>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {sent ? (
            <View style={styles.card} testID="forgot-sent">
              <Ionicons name="mail-open-outline" size={28} color={InkColors.ink} />
              <Text style={styles.title}>메일을 보냈어요</Text>
              <Text style={styles.text}>
                <Text style={{ fontWeight: '800', color: InkColors.ink }}>{email.trim()}</Text> 로 비밀번호를 새로 정하는 링크를 보냈어요. 링크는 한 번만 쓸 수 있어요.
              </Text>
              <Text style={styles.hint}>메일이 안 보이면 스팸함을 확인해 주세요. 가입한 이메일이 아니면 메일이 오지 않아요.</Text>
              <Pressable
                disabled={cooldown > 0 || busy}
                onPress={() => void submit()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, (cooldown > 0 || busy) && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryText}>{cooldown > 0 ? `${cooldown}초 뒤 다시 보낼 수 있어요` : '다시 보내기'}</Text>
              </Pressable>
              <Pressable onPress={() => router.replace('/login')} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}>
                <Text style={styles.primaryText}>로그인으로</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card} testID="forgot-form">
              <Text style={styles.title}>가입한 이메일을 알려 주세요</Text>
              <Text style={styles.text}>비밀번호를 새로 정할 수 있는 링크를 메일로 보내 드려요.</Text>
              <Text style={styles.label}>이메일</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={InkColors.ink3}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
                onSubmitEditing={() => void submit()}
                accessibilityLabel="이메일"
                testID="forgot-email"
              />
              {err ? <Text style={styles.err}>{err}</Text> : null}
              <Pressable disabled={busy} onPress={() => void submit()} accessibilityRole="button" testID="forgot-submit" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>재설정 링크 보내기</Text>}
              </Pressable>
              <Text style={styles.hint}>이메일이 기억나지 않으면 가입한 전화번호와 함께 문의해 주세요. 설정 &gt; 문의하기에서 보낼 수 있어요.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardShift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  body: { flexGrow: 1, padding: Space.xl, paddingTop: Space.sm, justifyContent: 'center' },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line, padding: Space.gutter, gap: Space.sm, alignItems: 'stretch' },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  text: { fontSize: 14, lineHeight: 21, color: InkColors.ink2 },
  hint: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3 },
  label: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2, marginTop: Space.sm },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, height: 46, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.bg },
  err: { fontSize: 12.5, color: BrandColors.badText },
  primary: { marginTop: Space.sm, minHeight: 50, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2, textDecorationLine: 'underline' },
});
