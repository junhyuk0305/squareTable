import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';

// 프로필 편집 + 비밀번호 변경 (오너·주니어 공용).
export default function AccountEdit() {
  const router = useRouter();
  const { userName, email, role, storeName } = useSessionStore();
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const changePassword = useSessionStore((s) => s.changePassword);
  const renameStore = useSessionStore((s) => s.renameStore);
  const storeRenameInfo = useSessionStore((s) => s.storeRenameInfo);

  const [name, setName] = useState(userName);
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 가게 이름 편집(사장 전용)
  const [store, setStore] = useState(storeName);
  const [remaining, setRemaining] = useState(() => storeRenameInfo().remaining);

  const saveStore = async () => {
    if (!store.trim()) return setMsg({ ok: false, text: '가게 이름을 입력해주세요.' });
    setBusy(true);
    setMsg(null);
    const { error, remaining: left } = await renameStore(store.trim());
    setBusy(false);
    setRemaining(left);
    setMsg(error ? { ok: false, text: error } : { ok: true, text: '가게 이름을 변경했어요.' });
  };

  const saveProfile = async () => {
    if (!name.trim()) return setMsg({ ok: false, text: '이름을 입력해주세요.' });
    setBusy(true);
    setMsg(null);
    const phone_last4 = phone.replace(/\D/g, '').slice(-4) || undefined;
    const { error } = await updateProfile({ name: name.trim(), phone_last4 });
    setBusy(false);
    setMsg(error ? { ok: false, text: error } : { ok: true, text: '프로필을 저장했어요.' });
  };

  const savePw = async () => {
    if (pw.length < 6) return setMsg({ ok: false, text: '비밀번호는 6자 이상이에요.' });
    if (pw !== pw2) return setMsg({ ok: false, text: '비밀번호가 서로 달라요.' });
    setBusy(true);
    setMsg(null);
    const { error } = await changePassword(pw);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error });
    setPw('');
    setPw2('');
    setMsg({ ok: true, text: '비밀번호를 변경했어요.' });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '프로필 편집', headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.group}>기본 정보</Text>
        <View style={styles.card}>
          <Text style={styles.label}>이름<Text style={styles.req}> *</Text></Text>
          <TextInput value={name} onChangeText={setName} placeholder="이름" placeholderTextColor={InkColors.ink3} style={styles.input} />
          <Text style={styles.label}>이메일</Text>
          <View style={[styles.input, styles.readonly]}>
            <Text style={styles.readonlyText}>{email || '데모 계정'}</Text>
          </View>
          <Text style={styles.label}>전화번호</Text>
          <TextInput value={phone} onChangeText={setPhone} placeholder="010-0000-0000" placeholderTextColor={InkColors.ink3} keyboardType="phone-pad" style={styles.input} />
          <Pressable disabled={busy || !name.trim()} onPress={saveProfile} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, (busy || !name.trim()) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>프로필 저장</Text>}
          </Pressable>
        </View>

        {role === 'owner' && (
          <>
            <Text style={[styles.group, { color: BrandColors.brand }]}>가게 이름<Text style={styles.req}> *</Text> · 사장님만</Text>
            <View style={[styles.card, styles.storeCard]}>
              <TextInput value={store} onChangeText={setStore} placeholder="예: 착착 카페 신촌점" placeholderTextColor={InkColors.ink3} style={styles.input} />
              <View style={styles.storeMetaRow}>
                <View style={styles.storeChip}>
                  <Text style={styles.storeChipText}>14일 내 2회 변경 가능</Text>
                </View>
                <Text style={styles.storeRemain}>남은 변경 {remaining}회</Text>
              </View>
              <Pressable
                disabled={busy || remaining <= 0 || !store.trim()}
                onPress={saveStore}
                style={({ pressed }) => [styles.primary, { marginTop: 4 }, pressed && { opacity: 0.88 }, (busy || remaining <= 0 || !store.trim()) && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>{remaining <= 0 ? '변경 횟수 소진' : '가게 이름 저장'}</Text>}
              </Pressable>
            </View>
          </>
        )}

        <Text style={styles.group}>비밀번호 변경</Text>
        <View style={styles.card}>
          <Text style={styles.label}>새 비밀번호<Text style={styles.req}> *</Text></Text>
          <TextInput value={pw} onChangeText={setPw} placeholder="6자 이상" placeholderTextColor={InkColors.ink3} secureTextEntry style={styles.input} />
          <Text style={styles.label}>새 비밀번호 확인<Text style={styles.req}> *</Text></Text>
          <TextInput value={pw2} onChangeText={setPw2} placeholder="다시 입력" placeholderTextColor={InkColors.ink3} secureTextEntry style={styles.input} />
          <Pressable disabled={busy || !pw || !pw2} onPress={savePw} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.88 }, (busy || !pw || !pw2) && { opacity: 0.5 }]}>
            <Text style={styles.secondaryText}>비밀번호 변경</Text>
          </Pressable>
        </View>

        {msg && <Text style={[styles.msg, { color: msg.ok ? BrandColors.good : BrandColors.accent }]}>{msg.text}</Text>}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 8 },
  group: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginLeft: 4, marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 8, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 4 },
  req: { color: BrandColors.accent, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  storeCard: { borderColor: BrandColors.gold },
  storeMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  storeChip: { backgroundColor: BrandColors.brandSoft, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  storeChipText: { fontSize: 11, fontWeight: '700', color: InkColors.ink2 },
  storeRemain: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  readonly: { backgroundColor: InkColors.bgSoft, justifyContent: 'center' },
  readonlyText: { fontSize: 15, color: InkColors.ink3 },
  primary: { marginTop: 12, backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondary: { marginTop: 12, backgroundColor: InkColors.bgSoft, paddingVertical: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: InkColors.line },
  secondaryText: { color: InkColors.ink, fontSize: 15, fontWeight: '800' },
  msg: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 4 },
});
