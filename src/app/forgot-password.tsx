// /forgot-password — 비밀번호 찾기(2026-09-23 사용자 결정: **전화번호 인증**, 앱·웹 같은 화면).
//
//   사장님/직원 → 가입한 휴대폰 번호 → [인증번호 받기](엣지 otp send) → 인증번호 + 새 비밀번호 → [바꾸기]
//   (엣지 otp reset_password 가 코드를 대조하고 계정 비밀번호를 바꾼다) → 로그인 화면.
// 같은 번호가 사장·직원 두 계정을 가질 수 있어 역할을 먼저 고른다(가입 규칙과 같다). 이메일은 묻지 않는다.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { KeyboardShift } from '@/components/KeyboardShift';
import { usePhoneOtp, resetPasswordByPhone } from '@/lib/otp';
import { showToast } from '@/lib/store/useToastStore';
import { formatPhone, isValidPhone, normalizePhone, passwordError } from '@/lib/utils/validation';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

type Role = 'owner' | 'junior';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('owner');
  const [phone, setPhone] = useState('');
  const normalized = normalizePhone(phone);
  const otp = usePhoneOtp(normalized);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const sendCode = () => {
    setErr(null);
    if (!isValidPhone(normalized)) {
      setErr('휴대폰 번호 형식을 확인해 주세요.');
      return;
    }
    void otp.send();
  };

  const submit = async () => {
    setErr(null);
    if (!otp.sent) {
      setErr('먼저 인증번호를 받아 주세요.');
      return;
    }
    if (code.length !== 6) {
      setErr('인증번호 6자리를 입력해 주세요.');
      return;
    }
    const pe = passwordError(pw);
    if (pe) {
      setErr(pe);
      return;
    }
    if (pw !== pw2) {
      setErr('두 비밀번호가 서로 달라요.');
      return;
    }
    setBusy(true);
    const r = await resetPasswordByPhone({ phone: normalized, code, role, newPassword: pw });
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    setDone(true);
    showToast('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.', 'good');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenTitleHeader title="비밀번호 찾기" backFallback="/login" />
      <KeyboardShift>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {done ? (
            <View style={styles.card} testID="forgot-done">
              <Ionicons name="checkmark-circle-outline" size={28} color={InkColors.ink} />
              <Text style={styles.title}>비밀번호를 바꿨어요</Text>
              <Text style={styles.text}>새 비밀번호로 로그인해 주세요.</Text>
              <Pressable onPress={() => router.replace('/login')} accessibilityRole="button" testID="forgot-to-login" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}>
                <Text style={styles.primaryText}>로그인으로</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card} testID="forgot-form">
              <Text style={styles.title}>가입한 휴대폰 번호로 확인해요</Text>
              <Text style={styles.text}>문자로 받은 인증번호를 넣고 새 비밀번호를 정하면 바로 바뀌어요.</Text>

              <Text style={styles.label}>어떤 계정인가요?</Text>
              <View style={styles.seg}>
                {(['owner', 'junior'] as Role[]).map((r) => (
                  <Pressable key={r} onPress={() => setRole(r)} accessibilityRole="button" accessibilityState={{ selected: role === r }} style={[styles.segBtn, role === r && styles.segBtnOn]}>
                    <Text style={[styles.segText, role === r && styles.segTextOn]}>{r === 'owner' ? '사장님' : '직원'}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>휴대폰 번호</Text>
              <View style={styles.row}>
                <TextInput
                  value={phone}
                  onChangeText={(t) => setPhone(formatPhone(t))}
                  placeholder="010-0000-0000"
                  placeholderTextColor={InkColors.ink3}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  editable={!otp.verified}
                  style={[styles.input, styles.rowInput]}
                  accessibilityLabel="휴대폰 번호"
                  testID="forgot-phone"
                />
                <Pressable
                  onPress={sendCode}
                  disabled={otp.busy === 'send' || otp.countdown > 0}
                  accessibilityRole="button"
                  testID="forgot-send"
                  style={[styles.otpBtn, (otp.busy === 'send' || otp.countdown > 0) && { opacity: 0.45 }]}
                >
                  {otp.busy === 'send' ? (
                    <ActivityIndicator color={InkColors.bubbleText} />
                  ) : (
                    <Text style={styles.otpBtnText}>{otp.countdown > 0 ? `재발송 ${otp.countdown}초` : otp.sent ? '인증번호 재발송' : '인증번호 받기'}</Text>
                  )}
                </Pressable>
              </View>
              {otp.msg ? <Text style={styles.err}>{otp.msg}</Text> : null}

              {otp.sent ? (
                <>
                  <Text style={styles.label}>인증번호</Text>
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="인증번호 6자리"
                    placeholderTextColor={InkColors.ink3}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    style={styles.input}
                    accessibilityLabel="인증번호"
                    testID="forgot-code"
                  />
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
                    testID="forgot-pw"
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
                    testID="forgot-pw2"
                  />
                </>
              ) : null}

              {err ? <Text style={styles.err}>{err}</Text> : null}
              {otp.sent ? (
                <Pressable disabled={busy} onPress={() => void submit()} accessibilityRole="button" testID="forgot-submit" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
                  {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>비밀번호 바꾸기</Text>}
                </Pressable>
              ) : null}
              <Text style={styles.hint}>가입한 번호가 바뀌었으면 설정 &gt; 문의하기로 알려 주세요.</Text>
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
  title: { fontSize: 19, fontWeight: '900', color: InkColors.ink },
  text: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  hint: { fontSize: 13, lineHeight: 19, color: InkColors.ink3, marginTop: Space.xs },
  label: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2, marginTop: Space.sm },
  seg: { flexDirection: 'row', backgroundColor: InkColors.paper, borderRadius: Radius.pill, padding: 3, gap: 2 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.pill, alignItems: 'center' },
  segBtnOn: { backgroundColor: InkColors.ink },
  segText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink2 },
  segTextOn: { color: InkColors.bubbleText },
  // flexWrap + 입력칸 기준 폭 120 — 글자가 커져(OS 배율·앱 배율) 버튼이 넓어지면 버튼이 아랫줄로 내려간다.
  //   140 은 '010-0000-0000' 이 기본 크기에서 들어가는 폭이다. 360dp 기본에서는 지금처럼 한 줄이다.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, alignItems: 'center' },
  rowInput: { flexGrow: 1, flexShrink: 1, flexBasis: 120 },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: Space.md, minHeight: 48, fontSize: 16, color: InkColors.ink, backgroundColor: InkColors.bg },
  otpBtn: { minHeight: 48, paddingVertical: Space.sm, paddingHorizontal: 14, borderRadius: Radius.sm, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center', minWidth: 118, flexShrink: 1 },
  otpBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.bubbleText, textAlign: 'center' },
  err: { fontSize: 13.5, color: BrandColors.badText },
  primary: { marginTop: Space.sm, minHeight: 52, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
});
