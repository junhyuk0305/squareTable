import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { applyMockSeed } from '@/lib/demo/mockSeed';
import { HAS_SUPABASE } from '@/lib/supabase';
import { SocialAuthButtons } from '@/components/SocialAuthButtons';
import { formatBizNo, isValidBizNo, bizDigits } from '@/lib/utils/bizno';
import { isValidEmail, isValidPhone, normalizePhone, formatPhone, passwordError, formatBirthDate8, birthDateISO } from '@/lib/utils/validation';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { Radius, Elevation } from '@/lib/theme/elevation';
import type { Role } from '@/types';
import { INDUSTRIES } from '@/lib/config/industry';

export default function SignupScreen() {
  const router = useRouter();
  const enterMockStore = useSessionStore((s) => s.enterMockStore);
  const signUp = useSessionStore((s) => s.signUp);
  const createStore = useSessionStore((s) => s.createStore);
  const isPhoneTaken = useSessionStore((s) => s.isPhoneTaken);

  const [role, setRole] = useState<Role>('owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birth, setBirth] = useState(''); // YYYYMMDD 8자리(숫자만) — 서버 SSOT는 profiles.birth_date(0065)
  const [pw, setPw] = useState('');
  const [storeName, setStoreName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [industry, setIndustry] = useState('');

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

  // 이메일 입력창 아래 안내(중복가입 등). 이메일 인증은 추후 도입 예정 — 지금은 단계 없음.
  const [emailMsg, setEmailMsg] = useState<string | null>(null);

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

  const start = async () => {
    setErr(null);
    if (!allRequired) return setErr('필수 약관에 모두 동의해주세요.');

    // 필수 입력 항목 — 데모/실서버 공통으로 강제(이름·이메일·비밀번호 + 사장은 가게이름)
    if (!name.trim()) return setErr('이름을 입력해주세요.');
    if (!email.trim()) return setErr('이메일을 입력해주세요.');
    if (!isValidEmail(email)) return setErr('이메일 형식을 확인해주세요.');
    if (!pw) return setErr('비밀번호를 입력해주세요.');
    const pwErr = passwordError(pw);
    if (pwErr) return setErr(pwErr);
    if (!phone.trim()) return setErr('전화번호를 입력해주세요.');
    if (!isValidPhone(phone)) return setErr('전화번호 형식을 확인해주세요. (예: 010-1234-5678)');
    if (!birth) return setErr('생년월일을 입력해주세요.');
    if (!birthDateISO(birth)) return setErr('생년월일 8자리를 확인해주세요. (예: 19900131)');
    if (role === 'owner' && !storeName.trim()) return setErr('매장 이름을 입력해주세요.');
    if (role === 'owner' && !industry) return setErr('업종을 선택해주세요.');
    // 직원 초대코드는 선택 — 비우면 가입 후 '가게 연결'(junior/join)로 유도하므로 여기서 막지 않는다.

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
    // ★ 전체를 try/catch/finally 로 감싼다 — signUp/createStore/isPhoneTaken 은 네트워크 예외를 던질 수 있고,
    //   그때 finally 없이 setBusy(false) 를 놓치면 버튼이 무한 스피너로 멈춘 채(무음 행) 아무 안내도 못 준다.
    //   내부 조기 return 은 함수를 빠져나가도 finally 가 반드시 돌아 busy 를 해제한다.
    try {
      // 1) 계정 생성 — 이미 생성됐으면(가게 연결만 실패했던 경우) 건너뛴다.
      if (!accountReady) {
        // 전화번호 중복 사전검사(주키). 'taken'=차단, 'unknown'=검사실패도 진행하지 않고 차단
        // (우회시키면 트리거로 떨어진다 — 트리거는 이제 500 대신 phone=null로 살리지만, 사용자가
        //  모르게 ‘번호 없는 반쪽 가입’이 되므로 여기서 막고 재시도를 유도하는 게 맞다).
        const phoneCheck = await isPhoneTaken(normalizePhone(phone));
        if (phoneCheck === 'taken') {
          setEmailMsg(null);
          return setErr('이미 가입된 번호예요. 아래 ‘로그인’으로 들어와 주세요.');
        }
        if (phoneCheck === 'unknown') {
          return setErr('번호 확인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
        }
        const up = await signUp(email.trim(), pw, {
          name: name.trim(),
          role,
          phone: normalizePhone(phone),
          // 생년월일(필수) — 트리거(handle_new_user)가 프로필 SSOT 에 기록하고,
          // create_store/join_by_invite 가 누락을 서버에서 최종 거부한다(0065).
          birth_date: birthDateISO(birth) ?? undefined,
          // 사장: 이메일 인증으로 세션이 지연돼도 인증 후 첫 로그인에서 매장이 자동 생성되도록 매장 정보를 함께 싣는다.
          ...(role === 'owner'
            ? { store_name: storeName.trim(), industry, ...(bizDigits(bizNo) ? { biz_no: bizDigits(bizNo) } : {}) }
            : {}),
        });
        if (up.emailTaken) {
          // 중복 — 이메일 입력창 아래 안내로 표시
          setEmailMsg('이미 가입된 이메일이에요. 로그인해 주세요.');
          return;
        }
        if (up.error) {
          return setErr(up.error);
        }
        if (up.needsConfirm) {
          // 이메일 인증이 켜져 있어 세션이 아직 없는 경우. 사장은 매장 정보를 user_metadata 에 실어뒀으므로
          // 인증 후 로그인하면 loadProfile 이 매장을 자동 생성한다(데드엔드 없음).
          setEmailMsg(
            role === 'owner'
              ? '인증 메일을 보냈어요. 메일에서 인증하고 로그인하면 매장이 자동으로 만들어져요.'
              : '인증 메일을 보냈어요. 메일에서 인증한 뒤 로그인해 주세요.',
          );
          return;
        }
        setAccountReady(true); // 세션 확보 — 이후 실패는 매장 연결만 재시도
      }

      // 2) 매장 연결
      if (role === 'owner') {
        const cs = await createStore(storeName.trim(), industry, bizDigits(bizNo) || undefined, birthDateISO(birth) ?? undefined, { isOnboarding: true });
        // 계정은 이미 만들어졌으므로(accountReady) 재시도는 '가게 생성만' 다시 돈다. 버튼 라벨도 아래에서
        // '가게 다시 만들기'로 바뀌므로 안내 문구를 그 버튼과 일치시킨다(무엇을 누르면 되는지 명확화).
        if (cs.error) return setErr(`${cs.error} 아래 ‘매장 다시 만들기’를 누르면 매장만 다시 만들어요.`);
        // 노하우 온보딩으로 — 초대코드는 온보딩 완료 화면에서 안내(빈 매장 0건 방지).
        router.replace({ pathname: '/owner/onboarding', params: { code: cs.inviteCode ?? '------', industry } });
      } else {
        // 직원은 계정만 만들고 개인 허브(junior/hub)로 — 초대코드 입력은 hub 한 곳에서만 한다
        // (6칸 입력 + 실시간 에러 + 승인 대기 카드). 가입화면엔 코드칸을 두지 않아 '두 번 입력' 혼선을 없앤다.
        router.replace('/junior/hub');
      }
    } catch {
      // 네트워크 등 예기치 못한 예외 — 여기서 안 잡으면 busy 가 안 풀려 버튼이 무한 스피너로 멈춘다(무음 행 방지).
      // 계정이 이미 만들어졌으면(accountReady) 안내는 '가게 다시 만들기' 재시도로 자연히 이어진다.
      setErr('연결 문제로 완료하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
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

        <Field label="이름" value={name} onChange={setName} placeholder="홍길동" required />

        {/* 이메일 — 로그인 ID로 사용. 이메일 인증(확인 메일)은 추후 도입 예정. */}
        <View style={styles.field}>
          <Text style={styles.label}>이메일<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setEmailMsg(null);
            }}
            placeholder="you@example.com"
            placeholderTextColor={InkColors.ink3}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
          {emailMsg && <Text style={styles.emailOk}>{emailMsg}</Text>}
        </View>

        {/* 비밀번호 — 영문·숫자 조합 9자 이상. 입력 중 즉시 통과/안내 표시 */}
        <View style={styles.field}>
          <Text style={styles.label}>비밀번호<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={pw}
            onChangeText={setPw}
            placeholder="영문·숫자 조합 9자 이상"
            placeholderTextColor={InkColors.ink3}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />
          {pw.length > 0 && (
            <Text style={[styles.bizHint, passwordError(pw) ? styles.bizBad : styles.bizOk]}>
              {passwordError(pw) ?? '✓ 사용할 수 있는 비밀번호예요'}
            </Text>
          )}
        </View>

        <Field label="전화번호" value={phone} onChange={(v) => setPhone(formatPhone(v))} placeholder="010-1234-5678" keyboard="phone-pad" maxLength={13} required />

        {/* 생년월일 — 숫자 8자리 단일 필드(토스류 금융 서비스 표준 패턴). 입력 중 즉시 통과/안내 표시. */}
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
            <Text style={[styles.bizHint, birthDateISO(birth) ? styles.bizOk : styles.bizBad]}>
              {birthDateISO(birth)
                ? `✓ ${Number(birth.slice(0, 4))}년 ${Number(birth.slice(4, 6))}월 ${Number(birth.slice(6, 8))}일`
                : '생년월일 8자리를 입력해주세요'}
            </Text>
          )}
        </View>

        {role === 'owner' ? (
          <>
            <Field label="매장 이름" value={storeName} onChange={setStoreName} placeholder="예: 착착 카페 신촌점" required />
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

            {/* 요금제 안내는 가입 폼에 두지 않는다(인지부하 축소). 가입은 무료로 시작하고,
                가격 인지·업그레이드는 온보딩 완료 화면·설정(PricingTable)에서만 노출한다(SSOT=tiers.ts). */}
          </>
        ) : (
          <View style={styles.joinNote}>
            <Ionicons name="information-circle-outline" size={18} color={InkColors.ink2} />
            <Text style={styles.joinNoteText}>
              가입하면 개인 홈으로 이동해요. 거기서 사장님께 받은 <Text style={styles.joinNoteStrong}>6자리 초대코드</Text>를 넣으면 매장에 합류 신청이 돼요.
            </Text>
          </View>
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

        {/* 버튼은 항상 누를 수 있게 둔다 — 미충족 항목은 start()의 순차 검증이 '무엇이 왜 안 되는지'
            정확한 문구로 알려준다(비활성 버튼이 무반응이라 이유를 못 알려주던 문제 해소). */}
        <Pressable
          onPress={start}
          disabled={busy}
          style={({ pressed }) => [styles.primary, busy && styles.primaryDisabled, pressed && !busy && { opacity: 0.88 }]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            // 계정 생성까지 끝난 뒤 가게 연결만 실패해 재시도하는 상태면 라벨을 '가게 다시 만들기'로 바꿔
            // (계정은 이미 있으니 다시 안 만든다는 뜻) 에러 안내문과 일치시킨다.
            <Text style={styles.primaryText}>
              {role === 'owner' ? (accountReady ? '매장 다시 만들기' : '매장 만들고 시작하기') : '가입하고 시작하기'}
            </Text>
          )}
        </Pressable>

        {/* 소셜 로그인(구글 등) — 가입도 소셜로 시작 가능. 웹 전용, 데모 빌드엔 렌더 안 됨. */}
        <SocialAuthButtons />

        <Pressable onPress={() => router.replace('/login')} style={styles.loginRow}>
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
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secure?: boolean;
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
        secureTextEntry={secure}
        keyboardType={keyboard}
        maxLength={maxLength}
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
    borderWidth: 2,
    borderColor: InkColors.line,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  // 선택 = 잉크 테두리 + 소프트 섀도로 '선택된 border'를 굵게(bold) 강조(입력칸 선택 효과와 통일).
  roleCardOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB', ...Elevation.e1 },
  // 그림 이모지 금지(워딩 §2.3) — Ionicons로 교체. 아이콘도 Text 기반이라 글자 크기 설정에 함께 반응한다.
  roleIcon: { marginBottom: 4 },
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
  joinNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, backgroundColor: BrandColors.brandSoft, borderRadius: Radius.md, padding: 14 },
  joinNoteText: { flex: 1, fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  joinNoteStrong: { fontWeight: '800', color: InkColors.ink },
  // 안내 문구(이미 가입된 이메일 등) — 성공 초록이 아닌 중립 톤으로 오해 방지.
  emailOk: { fontSize: 12, color: InkColors.ink2, fontWeight: '700', marginTop: 1 },
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
  consentText: { flex: 1, fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  consentReq: { fontWeight: '800', color: InkColors.ink },
  consentOpt: { fontWeight: '800', color: InkColors.ink3 },
  consentLink: { color: BrandColors.brand, fontWeight: '800', textDecorationLine: 'underline', fontSize: 12 },
  err: { fontSize: 15, color: BrandColors.accent, fontWeight: '600', lineHeight: 22 },
  primary: { marginTop: 6, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryDisabled: { backgroundColor: InkColors.line },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  loginRow: { alignItems: 'center', paddingVertical: 6 },
  loginText: { fontSize: 14, color: InkColors.ink3 },
  loginStrong: { color: BrandColors.brand, fontWeight: '800' },
});
