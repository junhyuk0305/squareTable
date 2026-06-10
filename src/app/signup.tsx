import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { formatBizNo, isValidBizNo } from '@/lib/utils/bizno';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import type { Role } from '@/types';

export default function SignupScreen() {
  const router = useRouter();
  const switchTo = useSessionStore((s) => s.switchTo);
  const signUp = useSessionStore((s) => s.signUp);
  const createStore = useSessionStore((s) => s.createStore);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);

  const [role, setRole] = useState<Role>('owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [storeName, setStoreName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [agreed, setAgreed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null); // 사장 가입 성공 → 발급된 초대코드

  const start = async () => {
    setErr(null);
    if (!agreed) return setErr('개인정보 수집·이용 동의가 필요해요.');

    // Supabase 미설정(로컬 데모): 입력 없이 바로 입장
    if (!HAS_SUPABASE) {
      switchTo(role);
      router.replace(role === 'owner' ? '/owner/dashboard' : '/junior/chat');
      return;
    }

    if (!name.trim() || !email.trim() || !pw) return setErr('이름·이메일·비밀번호를 입력해주세요.');
    if (role === 'owner' && !storeName.trim()) return setErr('가게 이름을 입력해주세요.');
    if (role === 'owner' && !isValidBizNo(bizNo)) return setErr('사업자등록번호 10자리를 정확히 입력해주세요.');
    if (role === 'junior' && !inviteCode.trim()) return setErr('가게 초대코드를 입력해주세요.');

    setBusy(true);
    const phone_last4 = phone.replace(/\D/g, '').slice(-4) || undefined;
    const up = await signUp(email.trim(), pw, { name: name.trim(), role, phone_last4 });
    if (up.error) {
      setBusy(false);
      return setErr(/already|registered|exists/i.test(up.error) ? '이미 가입된 이메일이에요. 로그인해주세요.' : `가입 실패: ${up.error}`);
    }
    if (up.needsConfirm) {
      setBusy(false);
      return setErr('이메일 확인이 필요합니다. 메일함을 확인해주세요. (관리자: Supabase에서 이메일 확인을 끄면 바로 시작됩니다)');
    }

    if (role === 'owner') {
      const cs = await createStore(storeName.trim(), bizNo);
      setBusy(false);
      if (cs.error) return setErr(`가게 생성 실패: ${cs.error}`);
      setCreatedCode(cs.inviteCode ?? '------'); // 코드 보여주고 입장
    } else {
      const j = await joinByInvite(inviteCode.trim());
      setBusy(false);
      if (j.error) return setErr(j.error);
      router.replace('/junior/chat');
    }
  };

  // 사장 가입 성공 화면 — 발급된 초대코드 안내 후 입장
  if (createdCode) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ headerShown: true, title: '가게 생성 완료', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
        <View style={styles.successWrap}>
          <Text style={styles.successEmoji}>🎉</Text>
          <Text style={styles.successTitle}>가게가 만들어졌어요</Text>
          <Text style={styles.successSub}>직원·알바에게 아래 초대코드를 알려주세요</Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{createdCode}</Text>
          </View>
          <Text style={styles.codeHint}>알바가 회원가입에서 이 코드를 입력하면 바로 합류됩니다.</Text>
          <Pressable onPress={() => router.replace('/owner/dashboard')} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}>
            <Text style={styles.primaryText}>대시보드로 들어가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '회원가입', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 역할 */}
        <View style={styles.seg}>
          {(['owner', 'junior'] as Role[]).map((r) => (
            <Pressable key={r} onPress={() => setRole(r)} style={[styles.segBtn, role === r && styles.segBtnOn]}>
              <Text style={[styles.segText, role === r && styles.segTextOn]}>{r === 'owner' ? '사장님' : '직원·알바'}</Text>
            </Pressable>
          ))}
        </View>

        <Field label="이름" value={name} onChange={setName} placeholder="홍길동" />
        <Field label="이메일" value={email} onChange={setEmail} placeholder="you@example.com" keyboard="email-address" />
        <Field label="비밀번호" value={pw} onChange={setPw} placeholder="6자 이상" secure />
        <Field label="전화번호 (선택)" value={phone} onChange={setPhone} placeholder="010-0000-0000" keyboard="phone-pad" />

        {role === 'owner' ? (
          <>
            <Field label="가게 이름" value={storeName} onChange={setStoreName} placeholder="예: 스퀘어 카페 신촌점" />
            <View style={styles.field}>
              <Text style={styles.label}>사업자등록번호</Text>
              <TextInput
                value={bizNo}
                onChangeText={(v) => setBizNo(formatBizNo(v))}
                placeholder="123-45-67890"
                placeholderTextColor={InkColors.ink3}
                keyboardType="number-pad"
                style={styles.input}
              />
              {bizNo.length > 0 && (
                <Text style={[styles.bizHint, isValidBizNo(bizNo) ? styles.bizOk : styles.bizBad]}>
                  {isValidBizNo(bizNo) ? '✓ 형식이 올바른 번호예요' : '번호 10자리를 확인해주세요'}
                </Text>
              )}
            </View>
          </>
        ) : (
          <>
            <Field label="가게 초대코드" value={inviteCode} onChange={setInviteCode} placeholder="사장님께 받은 6자리 코드" keyboard="number-pad" />
            <Text style={styles.hint}>코드를 입력하면 가게에 바로 합류됩니다.</Text>
          </>
        )}

        {/* 개인정보 수집·이용 동의 (필수) */}
        <Pressable onPress={() => setAgreed((v) => !v)} style={styles.consentRow}>
          <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
            {agreed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            <Text style={styles.consentStrong}>[필수]</Text> 개인정보 수집·이용에 동의합니다.{' '}
            <Text style={styles.consentLink} onPress={() => router.push('/privacy')}>
              자세히 보기
            </Text>
          </Text>
        </Pressable>

        {err && <Text style={styles.err}>{err}</Text>}

        <Pressable
          onPress={start}
          disabled={!agreed || busy}
          style={({ pressed }) => [styles.primary, (!agreed || busy) && styles.primaryDisabled, pressed && agreed && !busy && { opacity: 0.88 }]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>{role === 'owner' ? '가게 만들고 시작하기' : '합류하고 시작하기'}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.replace('/')} style={styles.loginRow}>
          <Text style={styles.loginText}>이미 계정이 있나요? <Text style={styles.loginStrong}>로그인</Text></Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  keyboard,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboard?: 'phone-pad' | 'email-address' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={InkColors.ink3}
        secureTextEntry={secure}
        keyboardType={keyboard}
        autoCapitalize={keyboard === 'email-address' ? 'none' : 'sentences'}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 24, gap: 14 },
  seg: { flexDirection: 'row', backgroundColor: InkColors.bgSoft, borderRadius: 12, padding: 4, marginBottom: 4 },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  segTextOn: { color: InkColors.ink },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
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
  hint: { fontSize: 12, color: InkColors.ink3, marginTop: -4 },
  bizHint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  bizOk: { color: BrandColors.good },
  bizBad: { color: InkColors.ink3 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxOn: { backgroundColor: BrandColors.brand, borderColor: BrandColors.brand },
  checkmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  consentText: { flex: 1, fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
  consentStrong: { fontWeight: '800', color: InkColors.ink },
  consentLink: { color: BrandColors.brand, fontWeight: '800', textDecorationLine: 'underline' },
  err: { fontSize: 13, color: BrandColors.accent, fontWeight: '600', lineHeight: 19 },
  primary: { marginTop: 6, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryDisabled: { backgroundColor: InkColors.line },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  loginRow: { alignItems: 'center', paddingVertical: 6 },
  loginText: { fontSize: 14, color: InkColors.ink3 },
  loginStrong: { color: BrandColors.brand, fontWeight: '800' },

  // 사장 가입 성공
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  successEmoji: { fontSize: 48 },
  successTitle: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  successSub: { fontSize: 14, color: InkColors.ink3, textAlign: 'center' },
  codeBox: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: InkColors.line, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 36, marginTop: 8 },
  codeText: { fontSize: 34, fontWeight: '900', letterSpacing: 8, color: BrandColors.brand },
  codeHint: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', marginBottom: 12 },
});
