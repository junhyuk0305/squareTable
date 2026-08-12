import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { Appear } from '@/components/Appear';
import { logout } from '@/lib/auth';
import { formatBizNo, isValidBizNo, bizDigits } from '@/lib/utils/bizno';
import { normalizePhone, formatPhone } from '@/lib/utils/validation';
import { usePhoneOtp } from '@/lib/otp';
import { INDUSTRIES } from '@/lib/config/industry';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';

// 로그인 직후 매장 미연결 가드 화면(사장용) — junior/join 의 사장 버전.
// 회원가입에서 가게 생성을 끝내지 못했거나, 매장 연결이 풀린 사장이 로그인하면 이 화면으로 강제 라우팅된다.
// create_store 를 다시 호출해 매장(+초대코드)을 만들고 노하우 온보딩으로 넘긴다.
export default function OwnerCreateStore() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const createStore = useSessionStore((s) => s.createStore);
  // 이미 매장이 있는 사장이 스위처 '매장 추가'로 온 경우 = 추가 흐름 → 뒤로가기(취소) 허용 + 문구 교체.
  // 매장 0개(강제 온보딩)면 돌아갈 곳이 없어 뒤로가기를 막는다(기존 동작 유지).
  const isAddingStore = useSessionStore((s) => s.stores.length > 0);

  const [storeName, setStoreName] = useState('');
  const [industry, setIndustry] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── 전화번호 인증(0088 게이트) ────────────────────────────────────────────
  // 서버가 PHONE_NOT_VERIFIED 로 막았을 때만 연다. 미리 열지 않는 이유: 인증 여부는 서버만 알고
  // (phone_otps 는 클라가 못 읽는다), 무조건 열면 가입 폼에서 이미 인증한 대다수 사장에게 실 SMS를
  // 한 번 더 보내게 된다. 그래서 '막혔을 때 그 자리에서 푼다'로 둔다.
  const sessionPhone = useSessionStore((s) => s.phone);
  const [needPhone, setNeedPhone] = useState(false);
  const [phone, setPhone] = useState(formatPhone(sessionPhone ?? ''));
  const [otpCode, setOtpCode] = useState('');
  const otp = usePhoneOtp(normalizePhone(phone));

  const valid = !!storeName.trim() && !!industry && (!bizNo.trim() || isValidBizNo(bizNo));

  const submit = async () => {
    setErr(null);
    if (!storeName.trim()) return setErr('매장 이름을 입력해주세요.');
    if (!industry) return setErr('업종을 선택해주세요.');
    if (bizNo.trim() && !isValidBizNo(bizNo)) return setErr('사업자등록번호 형식(10자리)을 확인해주세요. 비워두면 나중에 등록할 수 있어요.');
    if (needPhone && !otp.verified) return setErr('전화번호 인증을 완료해주세요.');
    setBusy(true);
    // 매장 0개 강제 온보딩(첫매장 복구)이면 isOnboarding=true → 레이스성 plan_limit_store 를 복구.
    // 스위처 '매장 추가'(isAddingStore)면 false → 무료플랜의 진짜 요금제 거절을 그대로 노출.
    const cs = await createStore(storeName.trim(), industry, bizDigits(bizNo) || undefined, undefined, { isOnboarding: !isAddingStore });
    setBusy(false);
    // 인증이 없어서 막힌 것이면 화면을 떠나지 않고 인증 단계를 연다(문의 안내로 끝내지 않는다).
    if (cs.code === 'PHONE_NOT_VERIFIED') setNeedPhone(true);
    if (cs.error) return setErr(cs.error);
    router.replace({ pathname: '/owner/onboarding', params: { code: cs.inviteCode ?? '------', industry } });
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* 추가 흐름이면 뒤로가기 노출(headerLeft 미지정=owner/_layout의 HeaderBackButton 상속), 온보딩이면 차단. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: isAddingStore ? '매장 추가' : '매장 만들기',
          ...(isAddingStore
            ? { headerLeft: () => <HeaderBackButton fallback="/stores" /> }
            : { headerLeft: () => null, headerBackVisible: false }),
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Appear delay={0}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="storefront-outline" size={28} color={BrandColors.brand} />
          </View>
          <Text style={styles.title}>{isAddingStore ? '새 매장을 추가해요' : '아직 만들어진 매장이 없어요'}</Text>
          <Text style={styles.sub}>
            {isAddingStore
              ? <>매장을 만들면 <Text style={styles.strong}>직원 초대코드</Text>가{'\n'}바로 발급돼요. 지금 매장은 그대로 있어요.</>
              : <>{userName ? `${userName} 사장님, ` : ''}매장을 만들면 <Text style={styles.strong}>직원 초대코드</Text>가{'\n'}바로 발급돼요.</>}
          </Text>
        </View>
        </Appear>

        <Appear delay={60}>
        <View style={styles.card}>
          <Text style={styles.label}>매장 이름<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={storeName}
            onChangeText={(v) => {
              setErr(null);
              setStoreName(v);
            }}
            placeholder="예: 우리 카페 신촌점"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
          />

          <Text style={styles.label}>업종<Text style={styles.req}> *</Text></Text>
          <View style={styles.chipWrap}>
            {INDUSTRIES.map((it) => (
              <Pressable
                key={it}
                onPress={() => {
                  setErr(null);
                  setIndustry(it);
                }}
                style={[styles.chip, industry === it && styles.chipOn]}
              >
                <Text style={[styles.chipText, industry === it && styles.chipTextOn]}>{it}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>사업자등록번호 (선택)</Text>
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

          {/* 전화번호 인증 — 서버 게이트에 막혔을 때만 나타난다. 가입 폼의 OTP 한 벌과 같은 훅(usePhoneOtp)을
              쓴다(판정 복제 금지). 번호를 고치면 훅이 정규화 번호 비교로 sent/verified 를 스스로 푼다. */}
          {needPhone && (
            <View style={styles.otpBox}>
              <Text style={styles.label}>전화번호 인증<Text style={styles.req}> *</Text></Text>
              <Text style={styles.otpGuide}>매장을 만들려면 본인 확인이 한 번 필요해요.</Text>
              <View style={styles.otpRow}>
                <TextInput
                  value={phone}
                  onChangeText={(v) => { setErr(null); setPhone(formatPhone(v)); }}
                  placeholder="010-1234-5678"
                  placeholderTextColor={InkColors.ink3}
                  keyboardType="phone-pad"
                  maxLength={13}
                  style={[styles.input, styles.otpInput]}
                />
                {!otp.verified && (
                  <Pressable
                    onPress={() => void otp.send()}
                    disabled={otp.busy === 'send' || otp.countdown > 0}
                    style={[styles.otpBtn, (otp.busy === 'send' || otp.countdown > 0) && styles.otpBtnDim]}
                  >
                    {otp.busy === 'send'
                      ? <ActivityIndicator size="small" color={InkColors.ink2} />
                      : <Text style={styles.otpBtnText}>{otp.countdown > 0 ? `재발송 ${otp.countdown}초` : otp.sent ? '인증번호 재발송' : '인증번호 받기'}</Text>}
                  </Pressable>
                )}
              </View>
              {otp.sent && !otp.verified && (
                <View style={styles.otpRow}>
                  <TextInput
                    value={otpCode}
                    onChangeText={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="인증번호 6자리"
                    placeholderTextColor={InkColors.ink3}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[styles.input, styles.otpInput]}
                  />
                  <Pressable
                    onPress={() => void otp.verify(otpCode)}
                    disabled={otp.busy === 'verify' || otpCode.length !== 6}
                    style={[styles.otpBtn, (otp.busy === 'verify' || otpCode.length !== 6) && styles.otpBtnDim]}
                  >
                    {otp.busy === 'verify'
                      ? <ActivityIndicator size="small" color={InkColors.ink2} />
                      : <Text style={styles.otpBtnText}>인증하기</Text>}
                  </Pressable>
                </View>
              )}
              {otp.verified && <Text style={[styles.bizHint, styles.bizOk]}>✓ 인증된 번호예요. 이제 매장을 만들 수 있어요.</Text>}
              {otp.msg && <Text style={styles.otpMsg}>{otp.msg}</Text>}
            </View>
          )}

          {err && <Text style={styles.err}>{err}</Text>}
          <Pressable
            disabled={busy || !valid}
            onPress={submit}
            style={({ pressed }) => [styles.primary, pressed && valid && { opacity: 0.88 }, (busy || !valid) && { opacity: 0.5 }]}
          >
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>매장 만들고 시작하기</Text>}
          </Pressable>
        </View>
        </Appear>

        <Appear delay={120}>
        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>다른 계정으로 로그인</Text>
        </Pressable>
        </Appear>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 22 },
  hero: { alignItems: 'center', gap: 10 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: BrandColors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  sub: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', lineHeight: 22 },
  strong: { fontWeight: '800', color: InkColors.ink },

  card: { backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line, padding: 20, gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 6 },
  req: { color: BrandColors.accentText, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB' },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: BrandColors.brand },
  bizHint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  bizOk: { color: BrandColors.goodText },
  bizBad: { color: InkColors.ink3 },

  // 전화번호 인증 — 막혔을 때만 나타나는 단계라 카드 안에서 한 덩어리로 묶어 구분한다.
  otpBox: {
    gap: Space.sm, marginTop: Space.md, paddingTop: Space.md,
    borderTopWidth: 1, borderTopColor: InkColors.line,
  },
  otpGuide: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  otpRow: { flexDirection: 'row', gap: Space.sm },
  otpInput: { flex: 1 },
  otpBtn: {
    minWidth: 116, minHeight: 48, paddingHorizontal: Space.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  otpBtnDim: { opacity: 0.5 },
  otpBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  otpMsg: { fontSize: 12, fontWeight: '600', color: BrandColors.accentText },

  err: { fontSize: 15, color: BrandColors.accentText, fontWeight: '600', marginTop: 4 },
  primary: { marginTop: 12, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  logoutRow: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
});
