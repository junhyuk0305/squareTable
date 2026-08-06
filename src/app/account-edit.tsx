import { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { isValidPhone, normalizePhone, formatPhone, passwordError } from '@/lib/utils/validation';
import { INDUSTRIES } from '@/lib/config/industry';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';

// 프로필 편집 + 비밀번호 변경 (오너·주니어 공용).
export default function AccountEdit() {
  const status = useSessionStore((s) => s.status);

  // 게이트(stores.tsx 와 동일 규칙): 미로그인 URL 직진입 시 빈 프로필 폼이 그려지지 않게 차단(2레이어 감사 F2).
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;

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
  const savedPhone = useSessionStore((s) => s.phone);
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
  // 저장된 전화번호(전체)를 표시 형식으로 시드 → 편집창을 열면 기존 번호가 바로 채워진다.
  const [phone, setPhone] = useState(() => formatPhone(savedPhone));
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  // 비밀번호는 이 화면에서 가장 드물게 쓰는 폼이라 접어 둔다(2026-08-06).
  // 접힘 상태에서도 여는 줄 자체는 항상 렌더되므로 되돌릴 수단이 함께 사라지지 않는다.
  const [pwOpen, setPwOpen] = useState(false);
  const pwRef = useRef<TextInput>(null);

  // 가게 이름 + 업종 편집(사장 전용) — 둘 다 같은 unit 속성이라 한 카드·한 저장으로 묶는다(2026-08-06).
  // 업종은 노하우팩 매칭 키.
  const [store, setStore] = useState(storeName);
  const [remaining, setRemaining] = useState(() => storeRenameInfo().remaining);
  const [biz, setBiz] = useState(industry);

  const nameChanged = store.trim() !== storeName;
  const bizChanged = !!biz && biz !== industry;

  const saveStoreInfo = async () => {
    if (!store.trim()) return showToast('매장 이름을 입력해주세요.', 'warn');
    if (!biz) return showToast('업종을 선택해주세요.', 'warn');
    setBusy(true);
    // 바뀐 쪽만 호출한다 — 이름이 그대로인데 renameStore를 부르면 '기존과 같은 이름' 에러가 떠서
    // 업종만 고친 저장이 실패로 보인다. 이름 변경 제한(14일 2회)의 판정은 renameStore·서버가 SSOT.
    // ★한쪽만 실패하는 경우를 따로 말한다(2026-08-06 검증에서 잡힘).
    //   이름·업종을 한 버튼으로 합치면서, 이름이 거절되면 업종이 실제로 저장됐는데도
    //   토스트에 이름 에러만 떠서 "아무것도 저장 안 됐다"로 읽혔다.
    let nameErr: string | null = null;
    let bizErr: string | null = null;
    if (nameChanged) {
      const { error, remaining: left } = await renameStore(store.trim());
      setRemaining(left);
      nameErr = error;
    }
    // 이름이 거절돼도(횟수 소진 등) 업종은 따로 저장한다 — 한쪽 실패가 다른 쪽을 막지 않는다.
    if (bizChanged) {
      const { error } = await updateIndustry(biz);
      bizErr = error;
    }
    setBusy(false);

    const bizSaved = bizChanged && !bizErr;
    if (nameErr && bizSaved) {
      // 부분 성공 — 무엇이 됐고 무엇이 안 됐는지 둘 다 말한다.
      showToast(`업종은 저장했어요. ${nameErr}`, 'warn');
    } else {
      const err = nameErr ?? bizErr;
      showToast(err ?? '매장 정보를 저장했어요.', err ? 'warn' : 'good');
    }
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

  // 펼치면 곧바로 입력 대기 상태로 — 펼치고 다시 탭하게 만들지 않는다(허브의 코드 입력 줄과 같은 규칙).
  const togglePw = () => {
    const next = !pwOpen;
    setPwOpen(next);
    if (next) setTimeout(() => pwRef.current?.focus(), 120);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '프로필 편집', headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Appear delay={0}>
          <SectionLabel title="기본 정보" />
        </Appear>
        <Appear delay={0}>
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
          <TextInput value={phone} onChangeText={(v) => setPhone(formatPhone(v))} placeholder="010-0000-0000" placeholderTextColor={InkColors.ink3} keyboardType="phone-pad" maxLength={13} autoComplete="tel" textContentType="telephoneNumber" style={styles.input} />
          <Pressable disabled={busy || !canSaveProfile} onPress={saveProfile} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, (busy || !canSaveProfile) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>프로필 저장</Text>}
          </Pressable>
        </View>
        </Appear>

        {role === 'owner' && (
          <>
            <Appear delay={60}>
              <SectionLabel title="매장 정보" hint="사장님만 바꿀 수 있어요" />
            </Appear>
            <Appear delay={60}>
            {/* 매장 이름과 업종은 같은 매장 속성이라 한 카드 안 두 행으로 둔다 — 카드가 나뉘어 있으면
                저장 버튼도 나뉘고, 사장 화면에 주 액션이 세 개가 된다(2026-08-06). */}
            <View style={[styles.card, styles.storeCard]}>
              <Text style={styles.label}>매장 이름<Text style={styles.req}> *</Text></Text>
              <TextInput value={store} onChangeText={setStore} placeholder="예: 우리 카페 신촌점" placeholderTextColor={InkColors.ink3} style={styles.input} />
              <View style={styles.storeMetaRow}>
                <View style={styles.storeChip}>
                  <Text style={styles.storeChipText}>14일 내 2회 변경 가능</Text>
                </View>
                <Text style={styles.storeRemain}>남은 변경 {remaining}회</Text>
              </View>

              <View style={styles.rowDivider} />

              <Text style={styles.label}>업종<Text style={styles.req}> *</Text></Text>
              <View style={styles.chipWrap}>
                {INDUSTRIES.map((it) => (
                  <Pressable key={it} onPress={() => setBiz(it)} style={[styles.chip, biz === it && styles.chipOn]}>
                    <Text style={[styles.chipText, biz === it && styles.chipTextOn]}>{it}</Text>
                  </Pressable>
                ))}
              </View>
              {/* 이름 변경 횟수가 0이어도 버튼을 막지 않는다 — 막으면 업종까지 못 고치게 된다.
                  이름만 서버가 거절하고 업종은 저장된다. */}
              <Pressable
                disabled={busy || !(nameChanged || bizChanged)}
                onPress={saveStoreInfo}
                style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.88 }, (busy || !(nameChanged || bizChanged)) && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color={InkColors.ink} /> : <Text style={styles.secondaryText}>매장 정보 저장</Text>}
              </Pressable>
            </View>
            </Appear>
          </>
        )}

        {/* 비밀번호 변경은 카드가 아니라 접힌 한 줄 — 이 화면에서 가장 드문 작업이고,
            카드가 계속 이어지면 전부 같은 무게로 읽힌다(배치 규칙 ①). 2026-08-06 */}
        <Appear delay={120}>
          <Pressable
            onPress={togglePw}
            accessibilityRole="button"
            accessibilityState={{ expanded: pwOpen }}
            accessibilityLabel="비밀번호 변경"
            style={({ pressed }) => [styles.pwToggle, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="lock-closed-outline" size={17} color={InkColors.ink2} />
            <Text style={styles.pwToggleText}>비밀번호 변경</Text>
            <Ionicons name={pwOpen ? 'chevron-up' : 'chevron-down'} size={16} color={InkColors.ink3} />
          </Pressable>
        </Appear>

        {pwOpen && (
          <Appear delay={0}>
          <View style={styles.pwPanel}>
            <Text style={styles.label}>새 비밀번호<Text style={styles.req}> *</Text></Text>
            {/* autoComplete="new-password": 브라우저/비번 매니저가 '기존 비밀번호'를 자동완성하지 못하게 막는다.
                (이메일 입력이 생기며 이 화면이 로그인 폼으로 오인돼 저장된 비번이 채워지던 보안 문제 방지) */}
            <TextInput
              ref={pwRef}
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
            {/* 여는 줄과 같은 말을 쓰지 않는다 — 위아래로 겹치면 어느 쪽을 눌러야 하는지 흐려진다. */}
            <Pressable disabled={busy || !pw || !pw2} onPress={savePw} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.88 }, (busy || !pw || !pw2) && { opacity: 0.5 }]}>
              <Text style={styles.secondaryText}>새 비밀번호 저장</Text>
            </Pressable>
          </View>
          </Appear>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 8, marginBottom: 8 },
  rowDivider: { height: 1, backgroundColor: InkColors.line, marginVertical: Space.xs },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 4 },
  req: { color: BrandColors.accentText, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  inputError: { borderColor: BrandColors.accent },
  pwHint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  pwOk: { color: BrandColors.goodText },
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
  // 비밀번호 여는 줄 — 카드와 형태를 일부러 다르게 둔다(상하 보더만 있는 행 = 카드 아님).
  pwToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 52,
    paddingHorizontal: Space.xs,
    marginTop: Space.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: InkColors.line,
  },
  pwToggleText: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  pwPanel: { gap: Space.sm, paddingHorizontal: Space.xs, paddingBottom: Space.sm },
  primary: { marginTop: 12, backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondary: { marginTop: 12, backgroundColor: InkColors.bgSoft, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1, borderColor: InkColors.line },
  secondaryText: { color: InkColors.ink, fontSize: 15, fontWeight: '800' },
});
