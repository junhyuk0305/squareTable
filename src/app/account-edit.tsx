import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { isValidPhone, normalizePhone, passwordError } from '@/lib/utils/validation';
import { INDUSTRIES } from '@/lib/config/industry';
import { HeaderBackButton } from '@/components/HeaderBackButton';

// 프로필 편집 + 비밀번호 변경 (오너·주니어 공용).
export default function AccountEdit() {
  const status = useSessionStore((s) => s.status);

  // 세션 복원(새로고침/콜드 진입) 중엔 폼이 데모/빈값으로 시드되지 않도록 로딩을 먼저 보여준다.
  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: true, title: '프로필 편집', headerLeft: () => <HeaderBackButton /> }} />
        <View style={styles.loading}>
          <ActivityIndicator color={InkColors.ink3} />
        </View>
      </SafeAreaView>
    );
  }
  // status 확정 후에만 폼을 마운트 → useState가 실제 프로필 값으로 시드된다(데모/빈값 시드 방지).
  return <AccountEditForm />;
}

function AccountEditForm() {
  const userName = useSessionStore((s) => s.userName);
  const email = useSessionStore((s) => s.email);
  const bio = useSessionStore((s) => s.bio);
  const role = useSessionStore((s) => s.role);
  const storeName = useSessionStore((s) => s.storeName);
  const industry = useSessionStore((s) => s.industry);
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const changePassword = useSessionStore((s) => s.changePassword);
  const renameStore = useSessionStore((s) => s.renameStore);
  const storeRenameInfo = useSessionStore((s) => s.storeRenameInfo);
  const updateIndustry = useSessionStore((s) => s.updateIndustry);

  const [name, setName] = useState(userName);
  const [emailInput, setEmailInput] = useState(email);
  const [intro, setIntro] = useState(bio);
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  // 가게 이름 편집(사장 전용)
  const [store, setStore] = useState(storeName);
  const [remaining, setRemaining] = useState(() => storeRenameInfo().remaining);

  // 업종 편집(사장 전용) — 가게 이름과 같은 unit 속성. 노하우팩 매칭 키.
  const [biz, setBiz] = useState(industry);
  const saveIndustry = async () => {
    if (!biz) return showToast('업종을 선택해주세요.', 'warn');
    setBusy(true);
    const { error } = await updateIndustry(biz);
    setBusy(false);
    showToast(error ?? '업종을 변경했어요.', error ? 'warn' : 'good');
  };

  const saveStore = async () => {
    if (!store.trim()) return showToast('가게 이름을 입력해주세요.', 'warn');
    setBusy(true);
    const { error, remaining: left } = await renameStore(store.trim());
    setBusy(false);
    setRemaining(left);
    showToast(error ?? '가게 이름을 변경했어요.', error ? 'warn' : 'good');
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValid = EMAIL_RE.test(emailInput.trim());
  const canSaveProfile = !!name.trim() && emailValid;

  const saveProfile = async () => {
    if (!name.trim()) return showToast('이름을 입력해주세요.', 'warn');
    if (!emailValid) return showToast('이메일을 올바르게 입력해주세요.', 'warn');
    const phoneInput = phone.trim();
    if (phoneInput && !isValidPhone(phoneInput)) return showToast('전화번호 형식을 확인해주세요. (예: 010-1234-5678)', 'warn');
    setBusy(true);
    const { error } = await updateProfile({
      name: name.trim(),
      email: emailInput.trim(),
      bio: intro.trim(),
      ...(phoneInput ? { phone: normalizePhone(phoneInput) } : {}),
    });
    setBusy(false);
    showToast(error ?? '프로필을 저장했어요.', error ? 'warn' : 'good');
  };

  const savePw = async () => {
    const pwErr = passwordError(pw);
    if (pwErr) return showToast(pwErr, 'warn');
    if (pw !== pw2) return showToast('비밀번호가 서로 달라요.', 'warn');
    setBusy(true);
    const { error } = await changePassword(pw);
    setBusy(false);
    if (error) return showToast(error, 'warn');
    setPw('');
    setPw2('');
    showToast('비밀번호를 변경했어요.', 'good');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '프로필 편집', headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.group}>기본 정보</Text>
        <View style={styles.card}>
          <Text style={styles.label}>이름<Text style={styles.req}> *</Text></Text>
          <TextInput value={name} onChangeText={setName} placeholder="이름" placeholderTextColor={InkColors.ink3} autoComplete="name" textContentType="name" style={styles.input} />
          <Text style={styles.label}>이메일<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={emailInput}
            onChangeText={setEmailInput}
            placeholder="name@example.com"
            placeholderTextColor={InkColors.ink3}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="email"
            autoComplete="email"
            textContentType="emailAddress"
            style={[styles.input, emailInput.length > 0 && !emailValid && styles.inputError]}
          />
          <Text style={styles.label}>한줄 소개</Text>
          <TextInput
            value={intro}
            onChangeText={setIntro}
            placeholder="예: 홀 담당, 라떼아트 연습 중이에요"
            placeholderTextColor={InkColors.ink3}
            maxLength={40}
            style={styles.input}
          />
          <Text style={styles.label}>전화번호</Text>
          <TextInput value={phone} onChangeText={setPhone} placeholder="010-0000-0000" placeholderTextColor={InkColors.ink3} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" style={styles.input} />
          <Pressable disabled={busy || !canSaveProfile} onPress={saveProfile} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, (busy || !canSaveProfile) && { opacity: 0.5 }]}>
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

            <Text style={[styles.group, { color: BrandColors.brand }]}>업종<Text style={styles.req}> *</Text> · 사장님만</Text>
            <View style={[styles.card, styles.storeCard]}>
              <View style={styles.chipWrap}>
                {INDUSTRIES.map((it) => (
                  <Pressable key={it} onPress={() => setBiz(it)} style={[styles.chip, biz === it && styles.chipOn]}>
                    <Text style={[styles.chipText, biz === it && styles.chipTextOn]}>{it}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                disabled={busy || !biz || biz === industry}
                onPress={saveIndustry}
                style={({ pressed }) => [styles.primary, { marginTop: 4 }, pressed && { opacity: 0.88 }, (busy || !biz || biz === industry) && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>업종 저장</Text>}
              </Pressable>
            </View>
          </>
        )}

        <Text style={styles.group}>비밀번호 변경</Text>
        <View style={styles.card}>
          <Text style={styles.label}>새 비밀번호<Text style={styles.req}> *</Text></Text>
          {/* autoComplete="new-password": 브라우저/비번 매니저가 '기존 비밀번호'를 자동완성하지 못하게 막는다.
              (이메일 입력이 생기며 이 화면이 로그인 폼으로 오인돼 저장된 비번이 채워지던 보안 문제 방지) */}
          <TextInput
            value={pw}
            onChangeText={setPw}
            placeholder="영문·숫자 조합 9자 이상"
            placeholderTextColor={InkColors.ink3}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          {pw.length > 0 && (
            <Text style={[styles.pwHint, passwordError(pw) ? styles.pwBad : styles.pwOk]}>
              {passwordError(pw) ?? '✓ 사용할 수 있는 비밀번호예요'}
            </Text>
          )}
          <Text style={styles.label}>새 비밀번호 확인<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={pw2}
            onChangeText={setPw2}
            placeholder="다시 입력"
            placeholderTextColor={InkColors.ink3}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable disabled={busy || !pw || !pw2} onPress={savePw} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.88 }, (busy || !pw || !pw2) && { opacity: 0.5 }]}>
            <Text style={styles.secondaryText}>비밀번호 변경</Text>
          </Pressable>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 8 },
  group: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginLeft: 4, marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 8, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 4 },
  req: { color: BrandColors.accent, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  inputError: { borderColor: BrandColors.accent },
  pwHint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  pwOk: { color: BrandColors.good },
  pwBad: { color: InkColors.ink3 },
  storeCard: { borderColor: BrandColors.gold },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB' },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: BrandColors.brand },
  storeMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  storeChip: { backgroundColor: BrandColors.brandSoft, borderRadius: Radius.pill, paddingVertical: 5, paddingHorizontal: 10 },
  storeChipText: { fontSize: 11, fontWeight: '700', color: InkColors.ink2 },
  storeRemain: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  primary: { marginTop: 12, backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondary: { marginTop: 12, backgroundColor: InkColors.bgSoft, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1, borderColor: InkColors.line },
  secondaryText: { color: InkColors.ink, fontSize: 15, fontWeight: '800' },
});
