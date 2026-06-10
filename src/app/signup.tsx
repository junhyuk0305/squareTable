import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import type { Role } from '@/types';

export default function SignupScreen() {
  const router = useRouter();
  const switchTo = useSessionStore((s) => s.switchTo);
  const [role, setRole] = useState<Role>('owner');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [storeName, setStoreName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [agreed, setAgreed] = useState(false);

  const start = () => {
    if (!agreed) return; // 개인정보 동의 필수
    switchTo(role);
    router.replace(role === 'owner' ? '/owner/dashboard' : '/junior/chat');
  };

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
        <Field label="전화번호" value={phone} onChange={setPhone} placeholder="010-0000-0000" keyboard="phone-pad" />
        <Field label="비밀번호" value={pw} onChange={setPw} placeholder="비밀번호" secure />

        {role === 'owner' ? (
          <Field label="가게 이름" value={storeName} onChange={setStoreName} placeholder="예: 스퀘어 카페 신촌점" />
        ) : (
          <>
            <Field label="가게 초대코드" value={inviteCode} onChange={setInviteCode} placeholder="사장님께 받은 6자리 코드" />
            <Text style={styles.hint}>코드를 입력하면 가게에 바로 합류됩니다. (데모에서는 승인 절차 없이 입장)</Text>
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

        <Pressable
          onPress={start}
          disabled={!agreed}
          style={({ pressed }) => [styles.primary, !agreed && styles.primaryDisabled, pressed && agreed && { opacity: 0.88 }]}
        >
          <Text style={styles.primaryText}>{role === 'owner' ? '가게 만들고 시작하기' : '합류 신청하고 시작하기'}</Text>
        </Pressable>
        <Text style={styles.demoNote}>* 데모: 입력 없이 바로 시작됩니다</Text>
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
  keyboard?: 'phone-pad';
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
  primary: { marginTop: 14, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryDisabled: { backgroundColor: InkColors.line },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  demoNote: { fontSize: 12, color: InkColors.ink3, textAlign: 'center' },
});
