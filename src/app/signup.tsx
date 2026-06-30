import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { applyMockSeed } from '@/lib/demo/mockSeed';
import { HAS_SUPABASE } from '@/lib/supabase';
import { formatBizNo, isValidBizNo, bizDigits } from '@/lib/utils/bizno';
import { isValidEmail, isValidPhone, normalizePhone } from '@/lib/utils/validation';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import type { Role } from '@/types';
import { INDUSTRIES } from '@/lib/config/industry';

export default function SignupScreen() {
  const router = useRouter();
  const enterMockStore = useSessionStore((s) => s.enterMockStore);
  const signUp = useSessionStore((s) => s.signUp);
  const createStore = useSessionStore((s) => s.createStore);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);
  const verifyEmail = useSessionStore((s) => s.verifyEmail);
  const isPhoneTaken = useSessionStore((s) => s.isPhoneTaken);

  const [role, setRole] = useState<Role>('owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [storeName, setStoreName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [industry, setIndustry] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  // 동의 항목 — 역할별로 필수/선택 구성이 달라진다(직원은 근로·급여정보 추가).
  type ConsentKey = 'age14' | 'terms' | 'collect' | 'labor' | 'marketing';
  const [consent, setConsent] = useState<Record<ConsentKey, boolean>>({
    age14: false,
    terms: false,
    collect: false,
    labor: false,
    marketing: false,
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // signUp 성공(세션 확보) 이후 가게 생성/합류만 실패한 경우 → 재시도 시 signUp을 다시 부르지 않게
  // (다시 부르면 'already registered'로 막혀 영구 데드엔드). 매장 연결만 재시도한다.
  const [accountReady, setAccountReady] = useState(false);

  // 이메일 인증 — '인증' 버튼 상태 + 입력창 아래 초록 안내
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const onVerifyEmail = async () => {
    setErr(null);
    setEmailMsg(null);
    const e = email.trim();
    if (!e) return setErr('이메일을 먼저 입력해주세요.');
    if (!isValidEmail(e)) return setErr('이메일 형식을 확인해주세요.');
    setVerifyingEmail(true);
    const r = await verifyEmail(e);
    setVerifyingEmail(false);
    if (r.status === 'demo') {
      setEmailMsg('데모 모드에선 이메일 인증이 필요 없어요');
      setEmailSent(true);
      return;
    }
    if (r.status === 'rate') return setEmailMsg('잠깐 후에 다시 시도해 주세요');
    if (r.status === 'error') return setErr(`인증 메일 발송 실패: ${r.message}`);
    // sent
    setEmailMsg(emailSent ? '인증 메일을 다시 보냈어요 (재인증)' : '인증 메일을 보냈어요. 메일함을 확인하세요');
    setEmailSent(true);
  };

  // 역할별 동의 항목 정의. doc은 '보기' 클릭 시 열 문서 라우트.
  type DocRoute = '/terms' | '/legal/collect' | '/legal/marketing' | '/legal/labor';
  const consentRows: { key: ConsentKey; label: string; required: boolean; doc?: DocRoute }[] =
    role === 'owner'
      ? [
          { key: 'age14', label: '만 14세 이상입니다', required: true },
          { key: 'terms', label: '서비스 이용약관', required: true, doc: '/terms' },
          { key: 'collect', label: '개인정보 수집·이용', required: true, doc: '/legal/collect' },
          { key: 'marketing', label: '마케팅·광고성 정보 수신(문자·이메일)', required: false, doc: '/legal/marketing' },
        ]
      : [
          { key: 'age14', label: '만 14세 이상입니다 (미성년자는 법정대리인 동의 필요)', required: true },
          { key: 'terms', label: '서비스 이용약관', required: true, doc: '/terms' },
          { key: 'collect', label: '개인정보 수집·이용', required: true, doc: '/legal/collect' },
          { key: 'labor', label: '근로·급여정보 처리', required: true, doc: '/legal/labor' },
          { key: 'marketing', label: '마케팅·광고성 정보 수신(문자·이메일)', required: false, doc: '/legal/marketing' },
        ];

  const requiredKeys = consentRows.filter((r) => r.required).map((r) => r.key);
  const allRequired = requiredKeys.every((k) => consent[k]);
  const allChecked = consentRows.every((r) => consent[r.key]);
  const toggleAll = () => {
    const next = !allChecked;
    setConsent((prev) => {
      const copy = { ...prev };
      consentRows.forEach((r) => (copy[r.key] = next));
      return copy;
    });
  };
  const toggleOne = (k: ConsentKey) => setConsent((prev) => ({ ...prev, [k]: !prev[k] }));

  // 필수 입력값이 모두 채워졌는지 — 제출 버튼 활성화 게이트(사장은 가게이름 포함)
  const requiredFilled =
    !!name.trim() && !!email.trim() && !!pw && !!phone.trim() &&
    (role === 'owner' ? (!!storeName.trim() && !!industry) : !!inviteCode.trim());

  const start = async () => {
    setErr(null);
    if (!allRequired) return setErr('필수 약관에 모두 동의해주세요.');

    // 필수 입력 항목 — 데모/실서버 공통으로 강제(이름·이메일·비밀번호 + 사장은 가게이름)
    if (!name.trim()) return setErr('이름을 입력해주세요.');
    if (!email.trim()) return setErr('이메일을 입력해주세요.');
    if (!isValidEmail(email)) return setErr('이메일 형식을 확인해주세요.');
    if (!pw) return setErr('비밀번호를 입력해주세요.');
    if (pw.length < 6) return setErr('비밀번호는 6자 이상이어야 해요.');
    if (!phone.trim()) return setErr('전화번호를 입력해주세요.');
    if (!isValidPhone(phone)) return setErr('전화번호 형식을 확인해주세요. (예: 010-1234-5678)');
    if (role === 'owner' && !storeName.trim()) return setErr('가게 이름을 입력해주세요.');
    if (role === 'owner' && !industry) return setErr('업종을 선택해주세요.');
    if (role === 'junior' && !inviteCode.trim()) return setErr('가게 초대코드를 입력해주세요.');

    // Supabase 미설정(로컬 데모): 새 계정 = 빈 매장에서 시작(데모 데이터 없음)
    if (!HAS_SUPABASE) {
      enterMockStore(name.trim(), role, storeName.trim(), industry);
      applyMockSeed(false);
      // 사장은 노하우 온보딩(추천 템플릿 자동등록)으로, 직원은 홈으로.
      if (role === 'owner') router.replace({ pathname: '/owner/onboarding', params: { industry } });
      else router.replace('/junior/home');
      return;
    }

    // 사업자등록번호는 선택 — 비우면 통과, 입력했으면 형식만 검증
    if (role === 'owner' && bizNo.trim() && !isValidBizNo(bizNo)) return setErr('사업자등록번호 형식(10자리)을 확인해주세요. 비워두면 나중에 등록할 수 있어요.');
    // 직원 초대코드는 선택 — 비우면 가입 후 '가게 연결' 화면으로 유도

    setBusy(true);
    // 1) 계정 생성 — 이미 생성됐으면(가게 연결만 실패했던 경우) 건너뛴다.
    if (!accountReady) {
      // 전화번호 중복 사전검사(주키) — 충돌 시 로그인 유도
      if (await isPhoneTaken(normalizePhone(phone))) {
        setBusy(false);
        setEmailMsg(null);
        return setErr('이미 가입된 번호예요. 아래 ‘로그인’으로 들어와 주세요.');
      }
      const up = await signUp(email.trim(), pw, { name: name.trim(), role, phone: normalizePhone(phone) });
      if (up.error) {
        setBusy(false);
        if (/already|registered|exists/i.test(up.error)) {
          // 중복 — 이메일 입력창 아래 초록 안내로 표시
          setEmailMsg('이미 가입된 이메일이에요. 로그인해 주세요.');
          return;
        }
        return setErr(`가입 실패: ${up.error}`);
      }
      if (up.needsConfirm) {
        setBusy(false);
        setEmailSent(true);
        setEmailMsg('인증 메일을 보냈어요. 메일에서 인증한 뒤 다시 시작해 주세요.');
        return;
      }
      setAccountReady(true); // 세션 확보 — 이후 실패는 매장 연결만 재시도
    }

    // 2) 매장 연결
    if (role === 'owner') {
      const cs = await createStore(storeName.trim(), industry, bizDigits(bizNo) || undefined);
      setBusy(false);
      if (cs.error) return setErr(`가게 생성 실패: ${cs.error} — '다시 시도'를 누르면 가게 생성만 다시 시도해요.`);
      // 노하우 온보딩으로 — 초대코드는 온보딩 완료 화면에서 안내(빈 매장 0건 방지).
      router.replace({ pathname: '/owner/onboarding', params: { code: cs.inviteCode ?? '------', industry } });
    } else {
      // 초대코드 필수 — 코드로 매장 합류(가입 시점 강제). 코드가 틀리면 계정은 유지되고
      // 매장 연결만 재시도(accountReady=true). 데이터 손실 없음.
      const j = await joinByInvite(inviteCode.trim());
      setBusy(false);
      if (j.error) return setErr(j.error);
      router.replace('/junior/home');
    }
  };


  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '회원가입', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 역할 — 가입 첫 단계에서 어떤 사용자인지 분명히 고른다 */}
        <Text style={styles.roleQ}>어떤 분이세요?</Text>
        <View style={styles.roleRow}>
          {(
            [
              { r: 'owner', emoji: '🏪', label: '사장님', desc: '가게를 운영하고\n노하우를 등록해요' },
              { r: 'junior', emoji: '🧑‍🍳', label: '직원·알바', desc: '초대코드로\n가게에 합류해요' },
            ] as const
          ).map((o) => (
            <Pressable key={o.r} onPress={() => setRole(o.r)} style={[styles.roleCard, role === o.r && styles.roleCardOn]}>
              <Text style={styles.roleEmoji}>{o.emoji}</Text>
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

        <Field label="이름" value={name} onChange={setName} placeholder="홍길동" required />

        {/* 이메일 + 인증 버튼 */}
        <View style={styles.field}>
          <Text style={styles.label}>이메일<Text style={styles.req}> *</Text></Text>
          <View style={styles.emailRow}>
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setEmailMsg(null);
                setEmailSent(false);
              }}
              placeholder="you@example.com"
              placeholderTextColor={InkColors.ink3}
              keyboardType="email-address"
              autoCapitalize="none"
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable
              onPress={onVerifyEmail}
              disabled={verifyingEmail || !email.trim()}
              style={({ pressed }) => [styles.verifyBtn, (verifyingEmail || !email.trim()) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              {verifyingEmail ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.verifyBtnText}>{emailSent ? '재전송' : '인증'}</Text>}
            </Pressable>
          </View>
          {emailMsg && <Text style={styles.emailOk}>{emailMsg}</Text>}
        </View>

        <Field label="비밀번호" value={pw} onChange={setPw} placeholder="6자 이상" secure required />
        <Field label="전화번호" value={phone} onChange={setPhone} placeholder="010-1234-5678" keyboard="phone-pad" required />

        {role === 'owner' ? (
          <>
            <Field label="가게 이름" value={storeName} onChange={setStoreName} placeholder="예: 착착 카페 신촌점" required />
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
                <Text style={[styles.bizHint, isValidBizNo(bizNo) ? styles.bizOk : styles.bizBad]}>
                  {isValidBizNo(bizNo) ? '✓ 형식이 올바른 번호예요' : '번호 10자리를 확인해주세요'}
                </Text>
              )}
            </View>
          </>
        ) : (
          <>
            <Field label="가게 초대코드" value={inviteCode} onChange={setInviteCode} placeholder="사장님께 받은 6자리 코드" keyboard="number-pad" required />
            <Text style={styles.hint}>사장님께 받은 6자리 코드가 있어야 가입할 수 있어요.</Text>
          </>
        )}

        {/* 동의 — 전체동의 + 항목별 토글, 필수/선택 분리 */}
        <View style={styles.consentBox}>
          <Pressable onPress={toggleAll} style={styles.consentAll}>
            <View style={[styles.checkbox, allChecked && styles.checkboxOn]}>
              {allChecked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.consentAllText}>약관에 모두 동의합니다</Text>
          </Pressable>
          <View style={styles.consentDivider} />
          {consentRows.map((r) => (
            <Pressable key={r.key} onPress={() => toggleOne(r.key)} style={styles.consentRow}>
              <View style={[styles.checkboxSm, consent[r.key] && styles.checkboxOn]}>
                {consent[r.key] && <Text style={styles.checkmarkSm}>✓</Text>}
              </View>
              <Text style={styles.consentText}>
                <Text style={r.required ? styles.consentReq : styles.consentOpt}>{r.required ? '[필수] ' : '[선택] '}</Text>
                {r.label}
              </Text>
              {r.doc && (
                <Text style={styles.consentLink} onPress={() => router.push(r.doc!)}>
                  보기
                </Text>
              )}
            </Pressable>
          ))}
        </View>

        {err && <Text style={styles.err}>{err}</Text>}

        <Pressable
          onPress={start}
          disabled={!allRequired || !requiredFilled || busy}
          style={({ pressed }) => [styles.primary, (!allRequired || !requiredFilled || busy) && styles.primaryDisabled, pressed && allRequired && requiredFilled && !busy && { opacity: 0.88 }]}
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
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboard?: 'phone-pad' | 'email-address' | 'number-pad';
  required?: boolean;
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
  roleQ: { fontSize: 16, fontWeight: '800', color: InkColors.ink, marginBottom: 2 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  roleCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: InkColors.line,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  roleCardOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB' },
  roleEmoji: { fontSize: 28 },
  roleLabel: { fontSize: 16, fontWeight: '800', color: InkColors.ink2, marginTop: 4 },
  roleLabelOn: { color: BrandColors.brand },
  roleDesc: { fontSize: 12, color: InkColors.ink3, lineHeight: 17 },
  roleCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: BrandColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCheckMark: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  req: { color: BrandColors.accent, fontWeight: '900' },
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
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyBtn: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: BrandColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  verifyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  emailOk: { fontSize: 12, color: BrandColors.good, fontWeight: '700', marginTop: 1 },
  bizHint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  bizOk: { color: BrandColors.good },
  bizBad: { color: InkColors.ink3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB' },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: BrandColors.brand },
  consentBox: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: InkColors.line, borderRadius: 14, padding: 14, marginTop: 8, gap: 4 },
  consentAll: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  consentAllText: { flex: 1, fontSize: 14, fontWeight: '800', color: InkColors.ink },
  consentDivider: { height: 1, backgroundColor: InkColors.line, marginVertical: 6 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
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
  checkboxSm: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxOn: { backgroundColor: BrandColors.brand, borderColor: BrandColors.brand },
  checkmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  checkmarkSm: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  consentText: { flex: 1, fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
  consentReq: { fontWeight: '800', color: InkColors.ink },
  consentOpt: { fontWeight: '800', color: InkColors.ink3 },
  consentLink: { color: BrandColors.brand, fontWeight: '800', textDecorationLine: 'underline', fontSize: 12 },
  err: { fontSize: 13, color: BrandColors.accent, fontWeight: '600', lineHeight: 19 },
  primary: { marginTop: 6, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryDisabled: { backgroundColor: InkColors.line },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  loginRow: { alignItems: 'center', paddingVertical: 6 },
  loginText: { fontSize: 14, color: InkColors.ink3 },
  loginStrong: { color: BrandColors.brand, fontWeight: '800' },
});
