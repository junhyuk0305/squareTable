import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { logout } from '@/lib/auth';
import { HAS_SUPABASE } from '@/lib/supabase';
import { INDUSTRIES } from '@/lib/config/industry';
import { formatBizNo, isValidBizNo, bizDigits } from '@/lib/utils/bizno';
import { isValidPhone, normalizePhone, formatPhone, formatBirthDate8, birthDateISO } from '@/lib/utils/validation';
import { usePhoneOtp } from '@/lib/otp';
import { Appear } from '@/components/Appear';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { Radius, Elevation } from '@/lib/theme/elevation';
import type { Role } from '@/types';

/**
 * 가입 후 프로필 완성 — 소셜 로그인(구글 등) 전용 착지 화면.
 * OAuth 는 가입 폼을 안 거쳐 전화/생년월일이 비어 있고 역할이 정해지지 않았다(트리거가 junior 로 시작).
 * 여기서 role·이름·전화·생년월일(+사장은 매장·업종)을 채운 뒤:
 *   · 직원 → complete_profile 저장 → 개인 허브(hub)로(거기서 초대코드 입력).
 *   · 사장 → complete_profile 저장 → create_store(오너 승격+매장 생성) → 노하우 온보딩.
 * 이 화면 자체는 index/역할 레이아웃의 needsProfileSetup 게이트가 강제 라우팅한다.
 */
export default function CompleteProfileScreen() {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const userName = useSessionStore((s) => s.userName);
  const phone0 = useSessionStore((s) => s.phone);
  const unitId = useSessionStore((s) => s.unitId);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const completeProfile = useSessionStore((s) => s.completeProfile);
  const createStore = useSessionStore((s) => s.createStore);
  const isPhoneTaken = useSessionStore((s) => s.isPhoneTaken);

  const [role, setRole] = useState<Role>('owner');
  const [name, setName] = useState(userName || '');
  const [phone, setPhone] = useState('');
  // 전화번호 SMS 인증 — 번호를 고치면 훅이 정규화 번호 비교로 sent/verified 를 자동으로 푼다.
  const otp = usePhoneOtp(normalizePhone(phone));
  const [otpCode, setOtpCode] = useState('');
  const [birth, setBirth] = useState('');
  const [storeName, setStoreName] = useState('');
  const [industry, setIndustry] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 사장 경로에서 프로필(phone)은 저장됐는데 매장 생성만 실패한 상태 — 아래 가드가 홈으로 튕기지
  // 않게 붙잡고, 재시도 시 completeProfile/중복검사를 건너뛰고 매장 생성만 다시 돈다.
  const [storeRetry, setStoreRetry] = useState(false);

  // 로그인 안 됐으면 랜딩으로, 이미 프로필이 완성됐으면(이 화면 불필요) 역할 홈으로 — 오유입/재방문 차단.
  // ★ !busy 필수: 제출 중엔 completeProfile 이 phone 을 먼저 채워 needsProfileSetup 이 false 로 바뀌는데,
  //   그 순간 이 가드가 발동하면 createStore 전에 홈으로 튕겨 사장 온보딩이 깨진다. 제출은 submit()이 끝에서
  //   명시적으로 라우팅하므로, 제출 중(busy)엔 가드를 쉰다.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (!busy && !storeRetry && HAS_SUPABASE && status === 'signed_in' && !needsProfileSetup({ status, phone: phone0, unitId, pendingUnitId })) {
    return <Redirect href="/hub" />;
  }

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr('이름을 입력해주세요.');
    if (!phone.trim()) return setErr('전화번호를 입력해주세요.');
    if (!isValidPhone(phone)) return setErr('전화번호 형식을 확인해주세요. (예: 010-1234-5678)');
    // SMS 인증 — 매장 재시도(storeRetry) 땐 phone 이 이미 저장돼 있어 재인증 불필요.
    if (HAS_SUPABASE && !storeRetry && !otp.verified) return setErr('전화번호 인증을 완료해주세요.');
    if (!birth) return setErr('생년월일을 입력해주세요.');
    if (!birthDateISO(birth)) return setErr('생년월일 8자리를 확인해주세요. (예: 19900131)');
    if (role === 'owner' && !storeName.trim()) return setErr('매장 이름을 입력해주세요.');
    if (role === 'owner' && !industry) return setErr('업종을 선택해주세요.');
    if (role === 'owner' && bizNo.trim() && !isValidBizNo(bizNo)) return setErr('사업자등록번호 형식(10자리)을 확인해주세요. 비워두면 나중에 등록할 수 있어요.');

    setBusy(true);
    // ★ try/catch/finally — completeProfile/createStore/isPhoneTaken 이 네트워크 예외를 던지면 finally 없이
    //   setBusy(false) 를 놓쳐 버튼이 무한 스피너로 멈춘다(무음 행). finally 로 항상 busy 를 해제한다.
    try {
      // 전화번호 중복 사전검사(가입 폼과 동일). 'unknown'(검사실패)도 진행 차단 — 서버 유니크가 최종 방어선.
      // ★ storeRetry(매장만 재시도) 땐 건너뛴다 — phone 이 이미 내 프로필에 저장돼 'taken'이 나온다.
      if (!storeRetry) {
        const phoneCheck = await isPhoneTaken(normalizePhone(phone));
        if (phoneCheck === 'taken') {
          return setErr('이미 사용 중인 번호예요. 다른 번호를 입력해 주세요.');
        }
        if (phoneCheck === 'unknown') {
          return setErr('번호 확인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
        }
      }

      const birthISO = birthDateISO(birth) ?? undefined;
      if (role === 'owner') {
        // ★ 순서: 프로필(phone) 먼저 → 매장 생성. 서버 게이트(_hold/0088)가 units INSERT 시점에
        //   "소유자 프로필의 인증된 번호"를 검사하므로 phone 이 먼저 기록돼 있어야 한다.
        //   (예전엔 create_store 먼저였다 — 실패 시 needsProfileSetup 유지로 이 화면에 남기 위해.
        //    그 붙잡는 역할은 이제 storeRetry 가 대신한다 — 위 가드 조건 참조.)
        if (!storeRetry) {
          const cp = await completeProfile(name.trim(), phone.trim(), birthISO ?? '');
          if (cp.error) return setErr(cp.error);
        }
        const cs = await createStore(storeName.trim(), industry, bizDigits(bizNo) || undefined, birthISO, { isOnboarding: true });
        if (cs.error) {
          setStoreRetry(true);
          return setErr(`${cs.error} 아래 '매장 다시 만들기'를 누르면 매장만 다시 만들어요.`);
        }
        router.replace({ pathname: '/owner/onboarding', params: { code: cs.inviteCode ?? '------', industry } });
      } else {
        // 직원: 프로필만 채우고(생년월일 기록 → 이후 hub 에서 초대코드 입력 시 join 통과) 개인 허브로.
        const cp = await completeProfile(name.trim(), phone.trim(), birthISO ?? '');
        if (cp.error) return setErr(cp.error);
        router.replace('/junior/hub');
      }
    } catch {
      setErr('연결 문제로 완료하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '프로필 완성', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Appear delay={0}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>거의 다 왔어요</Text>
          <Text style={styles.introSub}>착착을 시작하려면 몇 가지만 알려주세요.</Text>
        </View>
        </Appear>

        {/* 역할 — 소셜 로그인은 역할 정보가 없으니 여기서 고른다(트리거는 항상 직원으로 시작). */}
        <Appear delay={40}>
        <Text style={styles.roleQ}>어떤 분이세요?</Text>
        </Appear>
        <Appear delay={40}>
        <View style={styles.roleRow}>
          {(
            [
              { r: 'owner', icon: 'storefront', label: '사장님', desc: '매장을 운영하고\n노하우를 등록해요' },
              { r: 'junior', icon: 'person', label: '직원', desc: '초대코드로\n매장에 합류해요' },
            ] as const
          ).map((o) => (
            <Pressable key={o.r} onPress={() => setRole(o.r)} style={[styles.roleCard, role === o.r && styles.roleCardOn]}>
              <Ionicons name={o.icon} size={28} color={role === o.r ? InkColors.ink : InkColors.ink3} style={styles.roleIcon} />
              <Text style={[styles.roleLabel, role === o.r && styles.roleLabelOn]}>{o.label}</Text>
              <Text style={styles.roleDesc}>{o.desc}</Text>
              {role === o.r && (
                <View style={styles.roleCheck}>
                  <Text style={styles.roleCheckMark}>✓</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
        </Appear>

        <Appear delay={80}>
        <Field label="이름" value={name} onChange={setName} placeholder="홍길동" required />
        </Appear>

        {/* 전화번호 + SMS 인증(솔라피) — 가입 폼(signup)과 동일한 흐름. 데모는 입력만. */}
        <Appear delay={80}>
        <View style={styles.field}>
          <Text style={styles.label}>전화번호<Text style={styles.req}> *</Text></Text>
          <View style={styles.otpRow}>
            <TextInput
              value={phone}
              onChangeText={(v) => setPhone(formatPhone(v))}
              placeholder="010-1234-5678"
              placeholderTextColor={InkColors.ink3}
              keyboardType="phone-pad"
              maxLength={13}
              style={[styles.input, styles.otpInput]}
            />
            {HAS_SUPABASE && !otp.verified && (
              <Pressable
                onPress={() => {
                  if (!isValidPhone(phone)) return setErr('전화번호 형식을 확인해주세요. (예: 010-1234-5678)');
                  setErr(null);
                  void otp.send();
                }}
                disabled={otp.busy === 'send' || otp.countdown > 0}
                style={[styles.otpBtn, (otp.busy === 'send' || otp.countdown > 0) && styles.otpBtnDim]}
              >
                {otp.busy === 'send' ? (
                  <ActivityIndicator size="small" color={InkColors.ink2} />
                ) : (
                  <Text style={styles.otpBtnText}>
                    {otp.countdown > 0 ? `재발송 ${otp.countdown}초` : otp.sent ? '인증번호 재발송' : '인증번호 받기'}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
          {HAS_SUPABASE && otp.sent && !otp.verified && (
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
                {otp.busy === 'verify' ? (
                  <ActivityIndicator size="small" color={InkColors.ink2} />
                ) : (
                  <Text style={styles.otpBtnText}>인증하기</Text>
                )}
              </Pressable>
            </View>
          )}
          {HAS_SUPABASE && otp.verified && <Text style={[styles.hint, styles.hintOk]}>✓ 인증된 번호예요</Text>}
          {otp.msg && <Text style={styles.otpMsg}>{otp.msg}</Text>}
        </View>
        </Appear>

        <Appear delay={80}>
        <View style={styles.field}>
          <Text style={styles.label}>생년월일<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={birth}
            onChangeText={(v) => setBirth(formatBirthDate8(v))}
            placeholder="8자리 숫자 (예: 19900131)"
            placeholderTextColor={InkColors.ink3}
            keyboardType="number-pad"
            maxLength={8}
            style={styles.input}
          />
          {birth.length > 0 && (
            <Text style={[styles.hint, birthDateISO(birth) ? styles.hintOk : styles.hintBad]}>
              {birthDateISO(birth)
                ? `✓ ${Number(birth.slice(0, 4))}년 ${Number(birth.slice(4, 6))}월 ${Number(birth.slice(6, 8))}일`
                : '생년월일 8자리를 입력해주세요'}
            </Text>
          )}
        </View>
        </Appear>

        {role === 'owner' ? (
          <>
            <Appear delay={120}>
            <Field label="매장 이름" value={storeName} onChange={setStoreName} placeholder="예: 착착 카페 신촌점" required />
            </Appear>
            <Appear delay={120}>
            <View style={styles.field}>
              <Text style={styles.label}>업종<Text style={styles.req}> *</Text></Text>
              <View style={styles.chipWrap}>
                {INDUSTRIES.map((it) => (
                  <Pressable key={it} onPress={() => setIndustry(it)} style={[styles.chip, industry === it && styles.chipOn]}>
                    <Text style={[styles.chipText, industry === it && styles.chipTextOn]}>{it}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            </Appear>
            <Appear delay={120}>
            <View style={styles.field}>
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
                <Text style={[styles.hint, isValidBizNo(bizNo) ? styles.hintOk : styles.hintBad]}>
                  {isValidBizNo(bizNo) ? '✓ 형식이 올바른 번호예요' : '번호 10자리를 확인해주세요'}
                </Text>
              )}
            </View>
            </Appear>
          </>
        ) : (
          <Appear delay={120}>
          <View style={styles.joinNote}>
            <Ionicons name="information-circle-outline" size={18} color={InkColors.ink2} />
            <Text style={styles.joinNoteText}>
              저장하면 개인 홈으로 이동해요. 거기서 사장님께 받은 <Text style={styles.joinNoteStrong}>6자리 초대코드</Text>를 넣으면 매장에 합류 신청이 돼요.
            </Text>
          </View>
          </Appear>
        )}

        {err && <Text style={styles.err}>{err}</Text>}

        <Appear delay={160}>
        <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.primary, busy && styles.primaryDisabled, pressed && !busy && { opacity: 0.88 }]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{role === 'owner' ? (storeRetry ? '매장 다시 만들기' : '매장 만들고 시작하기') : '저장하고 시작하기'}</Text>}
        </Pressable>
        </Appear>

        <Appear delay={160}>
        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>다른 계정으로 <Text style={styles.logoutStrong}>로그인</Text></Text>
        </Pressable>
        </Appear>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboard,
  required,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  keyboard?: 'phone-pad' | 'email-address' | 'number-pad';
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.req}> *</Text>}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={InkColors.ink3}
        keyboardType={keyboard}
        maxLength={maxLength}
        autoCapitalize="sentences"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 24, gap: 14 },
  intro: { gap: 4, marginBottom: 2 },
  introTitle: { fontSize: 20, fontWeight: '900', color: InkColors.ink },
  introSub: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  roleQ: { fontSize: 16, fontWeight: '800', color: InkColors.ink, marginBottom: 2 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  roleCard: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: InkColors.line, borderRadius: 16, padding: 16, gap: 4 },
  roleCardOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB', ...Elevation.e1 },
  // 그림 이모지 금지(워딩 §2.3) — Ionicons로 교체. 아이콘도 Text 기반이라 글자 크기 설정에 함께 반응한다.
  roleIcon: { marginBottom: 4 },
  roleLabel: { fontSize: 16, fontWeight: '800', color: InkColors.ink2, marginTop: 4 },
  roleLabelOn: { color: BrandColors.brand },
  roleDesc: { fontSize: 12, color: InkColors.ink3, lineHeight: 17 },
  roleCheck: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  roleCheckMark: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  req: { color: BrandColors.accent, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  hint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  hintOk: { color: BrandColors.good },
  hintBad: { color: InkColors.ink3 },
  otpRow: { flexDirection: 'row', gap: Space.sm },
  otpInput: { flex: 1 },
  otpBtn: { minWidth: 116, paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  otpBtnDim: { opacity: 0.5 },
  otpBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  otpMsg: { fontSize: 12, fontWeight: '600', color: BrandColors.accent, marginTop: -2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB' },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: BrandColors.brand },
  joinNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, backgroundColor: BrandColors.brandSoft, borderRadius: Radius.md, padding: 14 },
  joinNoteText: { flex: 1, fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  joinNoteStrong: { fontWeight: '800', color: InkColors.ink },
  err: { color: BrandColors.accent, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  primary: { marginTop: Space.sm, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '800' },
  logoutRow: { alignItems: 'center', paddingVertical: 10 },
  logoutText: { fontSize: 14, lineHeight: 20, color: InkColors.ink3 },
  logoutStrong: { color: InkColors.ink, fontWeight: '800' },
});
