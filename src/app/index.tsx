import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { applyMockSeed } from '@/lib/demo/mockSeed';
import { HAS_SUPABASE } from '@/lib/supabase';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import type { Role } from '@/types';

export default function LoginScreen() {
  const router = useRouter();
  const switchTo = useSessionStore((s) => s.switchTo);
  const signInWithPassword = useSessionStore((s) => s.signInWithPassword);
  const sendMagicLink = useSessionStore((s) => s.sendMagicLink);

  const [role, setRole] = useState<Role>('owner'); // 데모 폴백 전용
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // Supabase 미설정이면 기존 데모 동작(입력 무시, 역할 토글로 바로 입장)
  const demoEnter = () => {
    switchTo(role);
    applyMockSeed(true); // 데모 계정 = 데모 데이터로 입장
    router.replace(role === 'owner' ? '/owner/dashboard' : '/junior/chat');
  };

  const login = async () => {
    if (!HAS_SUPABASE) return demoEnter();
    if (!email || !pw) {
      setMsg('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setMsg('이메일 형식을 확인해주세요.');
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error, role: r } = await signInWithPassword(email.trim(), pw);
    setBusy(false);
    if (error) {
      setMsg('로그인 실패 — 이메일/비밀번호를 확인해주세요.');
      return;
    }
    router.replace(r === 'owner' ? '/owner/dashboard' : '/junior/chat');
  };

  const magicLink = async () => {
    if (!HAS_SUPABASE) return demoEnter();
    if (!email) {
      setMsg('이메일을 먼저 입력해주세요.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setMsg('이메일 형식을 확인해주세요.');
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await sendMagicLink(email.trim());
    setBusy(false);
    setMsg(error ? '메일 발송 실패. 잠시 후 다시 시도해주세요.' : '로그인 링크를 메일로 보냈어요. 메일함을 확인해주세요.');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.markRow}>
            <View style={styles.mark}>
              <Ionicons name="checkmark-sharp" size={18} color="#FFFFFF" />
            </View>
            <View style={[styles.mark, styles.markGold]}>
              <Ionicons name="checkmark-sharp" size={18} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.brand}>착착</Text>
          <Text style={styles.tagline}>할 일이 착착 끝나는 가게 · 현장 운영 AI</Text>
        </View>

        <View style={styles.card}>
          {!HAS_SUPABASE && (
            <View style={styles.seg}>
              {(['owner', 'junior'] as Role[]).map((r) => (
                <Pressable key={r} onPress={() => setRole(r)} style={[styles.segBtn, role === r && styles.segBtnOn]}>
                  <Text style={[styles.segText, role === r && styles.segTextOn]}>{r === 'owner' ? '사장님' : '직원·알바'}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.label}>이메일</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={InkColors.ink3}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />

          <Text style={styles.label}>비밀번호</Text>
          <TextInput
            value={pw}
            onChangeText={setPw}
            placeholder="비밀번호"
            placeholderTextColor={InkColors.ink3}
            secureTextEntry
            style={styles.input}
            onSubmitEditing={login}
          />

          <Pressable disabled={busy} onPress={login} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>로그인</Text>}
          </Pressable>

          {HAS_SUPABASE && (
            <Pressable disabled={busy} onPress={magicLink} style={styles.linkBtn}>
              <Text style={styles.linkText}>비밀번호 없이 <Text style={styles.linkStrong}>메일로 로그인</Text></Text>
            </Pressable>
          )}

          {msg && <Text style={styles.msg}>{msg}</Text>}
        </View>

        <View style={styles.signupBlock}>
          <Text style={styles.signupLead}>아직 계정이 없으신가요?</Text>
          <Pressable onPress={() => router.push('/signup')} style={({ pressed }) => [styles.signupBtn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.signupBtnText}>회원가입하고 시작하기</Text>
            <Ionicons name="arrow-forward" size={16} color={BrandColors.brand} />
          </Pressable>
        </View>

        <Text style={styles.demoNote}>
          {HAS_SUPABASE ? '파일럿 계정으로 로그인하세요' : '* 데모: 입력 없이 로그인됩니다'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 28 },
  header: { alignItems: 'center', gap: 8 },
  markRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  mark: { width: 30, height: 30, borderRadius: 9, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  markGold: { backgroundColor: BrandColors.gold },
  brand: { fontSize: 38, fontWeight: '900', letterSpacing: -1, color: BrandColors.brand },
  tagline: { fontSize: 13, color: InkColors.ink3, textAlign: 'center' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 20,
    gap: 10,
  },
  seg: { flexDirection: 'row', backgroundColor: InkColors.bgSoft, borderRadius: 12, padding: 4, marginBottom: 6 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  segTextOn: { color: InkColors.ink },

  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  primary: {
    marginTop: 12,
    backgroundColor: BrandColors.brand,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  linkBtn: { alignItems: 'center', paddingVertical: 10 },
  linkText: { fontSize: 14, color: InkColors.ink3 },
  linkStrong: { color: BrandColors.brand, fontWeight: '800' },
  msg: { fontSize: 13, color: InkColors.ink2, textAlign: 'center', marginTop: 2 },
  demoNote: { fontSize: 12, color: InkColors.ink3, textAlign: 'center' },
  signupBlock: { alignItems: 'center', gap: 10 },
  signupLead: { fontSize: 13, color: InkColors.ink3 },
  signupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'stretch',
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BrandColors.brand,
    backgroundColor: '#FFFFFF',
  },
  signupBtnText: { fontSize: 15, fontWeight: '800', color: BrandColors.brand },
});
