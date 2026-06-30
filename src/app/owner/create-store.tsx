import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { formatBizNo, isValidBizNo, bizDigits } from '@/lib/utils/bizno';
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

  const [storeName, setStoreName] = useState('');
  const [industry, setIndustry] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = !!storeName.trim() && !!industry && (!bizNo.trim() || isValidBizNo(bizNo));

  const submit = async () => {
    setErr(null);
    if (!storeName.trim()) return setErr('가게 이름을 입력해주세요.');
    if (!industry) return setErr('업종을 선택해주세요.');
    if (bizNo.trim() && !isValidBizNo(bizNo)) return setErr('사업자등록번호 형식(10자리)을 확인해주세요. 비워두면 나중에 등록할 수 있어요.');
    setBusy(true);
    const cs = await createStore(storeName.trim(), industry, bizDigits(bizNo) || undefined);
    setBusy(false);
    if (cs.error) return setErr(cs.error);
    router.replace({ pathname: '/owner/onboarding', params: { code: cs.inviteCode ?? '------', industry } });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '가게 만들기', headerLeft: () => null, headerBackVisible: false }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="storefront-outline" size={28} color={BrandColors.brand} />
          </View>
          <Text style={styles.title}>아직 만들어진 가게가 없어요</Text>
          <Text style={styles.sub}>
            {userName ? `${userName} 사장님, ` : ''}가게를 만들면 <Text style={styles.strong}>직원 초대코드</Text>가{'\n'}바로 발급돼요.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>가게 이름<Text style={styles.req}> *</Text></Text>
          <TextInput
            value={storeName}
            onChangeText={(v) => {
              setErr(null);
              setStoreName(v);
            }}
            placeholder="예: 착착 카페 신촌점"
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

          {err && <Text style={styles.err}>{err}</Text>}
          <Pressable
            disabled={busy || !valid}
            onPress={submit}
            style={({ pressed }) => [styles.primary, pressed && valid && { opacity: 0.88 }, (busy || !valid) && { opacity: 0.5 }]}
          >
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>가게 만들고 시작하기</Text>}
          </Pressable>
        </View>

        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>다른 계정으로 로그인</Text>
        </Pressable>
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
  sub: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  strong: { fontWeight: '800', color: InkColors.ink },

  card: { backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line, padding: 20, gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 6 },
  req: { color: BrandColors.accent, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: BrandColors.brand, backgroundColor: '#FFFDFB' },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: BrandColors.brand },
  bizHint: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  bizOk: { color: BrandColors.good },
  bizBad: { color: InkColors.ink3 },

  err: { fontSize: 13, color: BrandColors.accent, fontWeight: '600', marginTop: 4 },
  primary: { marginTop: 12, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  logoutRow: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
});
