import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { Appear, stagger } from '@/components/Appear';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { normalizeInviteCode } from '@/lib/utils/validation';

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
    const { error } = await joinByInvite(code.trim());
    setBusy(false);
    if (error) return setErr(error);
    // 합류 성공 → 챗으로. storeName은 세션이 이미 갱신함.
    router.replace('/junior/home');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardShift>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Appear delay={stagger(0)}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="storefront-outline" size={30} color={BrandColors.brand} />
          </View>
          <Text style={styles.title}>{userName ? `${userName}님, ` : ''}거의 다 왔어요</Text>
          <Text style={styles.sub}>
            아직 합류한 매장이 없어요.{'\n'}사장님께 받은 <Text style={styles.strong}>6자리 초대코드</Text>를 입력하면 바로 시작돼요.
          </Text>
        </View>
        </Appear>

        <Appear delay={stagger(1)}>
        <View style={styles.card}>
          <Text style={styles.label}>매장 초대코드</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(normalizeInviteCode(v))}
            placeholder="예: 482913"
            placeholderTextColor={InkColors.ink3}
            keyboardType="ascii-capable"
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            onSubmitEditing={join}
          />
          {err && <Text style={styles.err}>{err}</Text>}
          <Pressable disabled={busy} onPress={join} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>합류하기</Text>}
          </Pressable>
        </View>
        </Appear>

        <Appear delay={stagger(2)}>
        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>코드가 없으신가요?</Text>
          <Text style={styles.helpBody}>
            초대코드는 매장 사장님이 발급해요. 사장님께 “매장의 정석 초대코드 알려주세요”라고 요청해보세요.
          </Text>
        </View>
        </Appear>

        <Appear delay={stagger(3)}>
        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>다른 계정으로 로그인</Text>
        </Pressable>
        </Appear>
      </ScrollView>
      </KeyboardShift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 화면 바탕(Surface.screen). 헤더가 없는 가입 흐름 화면이라 위·아래 안전 영역을 SafeAreaView 가 그대로 든다.
  safe: { flex: 1, backgroundColor: Surface.screen },
  // 좌우·섹션 사이 = screenScrollStyle. 내용이 짧아 세로 가운데에 둔다.
  scroll: { ...screenScrollStyle, flexGrow: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', gap: 10 },
  iconWrap: { width: 64, height: 64, borderRadius: Radius.sheet, backgroundColor: BrandColors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  sub: { ...Type.desc, textAlign: 'center' },
  strong: { fontWeight: '800', color: InkColors.ink },
  card: { ...CardStyles.list, gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: TextColor.secondary },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 20, fontWeight: '800', letterSpacing: 4, textAlign: 'center', color: InkColors.ink, backgroundColor: Surface.input },
  err: { fontSize: 15, color: BrandColors.accentText, fontWeight: '600' },
  primary: { ...ButtonStyles.primary, marginTop: 6, backgroundColor: BrandColors.brand },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  // 안내 상자 — 바탕이 회색(#F4F5F7)이 되면서 옛 회색 면이 바탕에 묻혀 흰 목록 카드로 바꿨다.
  helpBox: { ...CardStyles.list, gap: 4 },
  helpTitle: { fontSize: 13, fontWeight: '800', color: TextColor.secondary },
  helpBody: { ...Type.desc },
  // 누르는 상자 48(RN-web 은 hitSlop 을 무시한다).
  logoutRow: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  logoutText: { fontSize: 13, color: TextColor.secondary, fontWeight: '600' },
});
