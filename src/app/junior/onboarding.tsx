import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';

// 가입했지만 아직 매장에 합류하지 않은 알바를 위한 화면.
// (매직링크 로그인·초대 전 가입·매장 종료로 unit_id가 비는 경우) — 빈 챗으로 떨어뜨리지 않고 여기로 유도.
export default function JuniorOnboarding() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async () => {
    if (!code.trim()) return setErr('사장님께 받은 초대코드를 입력해주세요.');
    setBusy(true);
    setErr(null);
    const { error, storeName } = await joinByInvite(code.trim());
    setBusy(false);
    if (error) return setErr(error);
    // 합류 성공 → 챗으로. storeName은 세션이 이미 갱신함.
    void storeName;
    router.replace('/junior/home');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="storefront-outline" size={30} color={BrandColors.brand} />
          </View>
          <Text style={styles.title}>{userName ? `${userName}님, ` : ''}거의 다 왔어요</Text>
          <Text style={styles.sub}>
            아직 합류한 매장이 없어요.{'\n'}사장님께 받은 <Text style={styles.strong}>6자리 초대코드</Text>를 입력하면 바로 시작돼요.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>가게 초대코드</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 6))}
            placeholder="예: 482913"
            placeholderTextColor={InkColors.ink3}
            keyboardType="number-pad"
            autoCapitalize="characters"
            style={styles.input}
            onSubmitEditing={join}
          />
          {err && <Text style={styles.err}>{err}</Text>}
          <Pressable disabled={busy} onPress={join} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>합류하기</Text>}
          </Pressable>
        </View>

        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>코드가 없으신가요?</Text>
          <Text style={styles.helpBody}>
            초대코드는 매장 사장님이 발급해요. 사장님께 “착착 초대코드 알려주세요”라고 요청해보세요.
          </Text>
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
  iconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: BrandColors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  sub: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  strong: { fontWeight: '800', color: InkColors.ink },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: InkColors.line, padding: 20, gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 20, fontWeight: '800', letterSpacing: 4, textAlign: 'center', color: InkColors.ink, backgroundColor: '#FFFFFF' },
  err: { fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  primary: { marginTop: 6, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  helpBox: { backgroundColor: InkColors.bgSoft, borderRadius: 12, padding: 16, gap: 4 },
  helpTitle: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  helpBody: { fontSize: 13, color: InkColors.ink3, lineHeight: 19 },
  logoutRow: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
});
