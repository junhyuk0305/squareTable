import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';

const CODE_LEN = 6;

// 로그인 직후 매장 미연결 가드 화면(와이어프레임 ★신규 junior/join).
// 회원가입에서 초대코드를 안 넣은 직원이 로그인하면 이 화면으로 강제 라우팅된다.
// onboarding과 달리 6자리 분리 입력 + 챗으로 바로 합류.
export default function JuniorJoin() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cells = Array.from({ length: CODE_LEN }, (_, i) => code[i] ?? '');

  const onChange = (v: string) => {
    setErr(null);
    setCode(v.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, CODE_LEN));
  };

  const join = async () => {
    if (code.length < CODE_LEN) return setErr('6자리 초대코드를 모두 입력해주세요.');
    setBusy(true);
    setErr(null);
    const { error } = await joinByInvite(code.trim());
    setBusy(false);
    if (error) return setErr(error);
    router.replace('/junior/home');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '가게 연결' }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="link-outline" size={28} color={BrandColors.brand} />
          </View>
          <Text style={styles.title}>아직 연결된 가게가 없어요</Text>
          <Text style={styles.sub}>
            {userName ? `${userName}님, ` : ''}사장님께 받은 <Text style={styles.strong}>6자리 초대코드</Text>를{'\n'}입력하면 바로 합류돼요.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>가게 초대코드</Text>
          {/* 보이는 6칸 + 위에 투명 입력으로 캡처 */}
          <Pressable onPress={() => inputRef.current?.focus()} style={styles.cells}>
            {cells.map((ch, i) => (
              <View key={i} style={[styles.cell, (i === code.length || (code.length === CODE_LEN && i === CODE_LEN - 1)) && styles.cellActive]}>
                <Text style={styles.cellText}>{ch}</Text>
              </View>
            ))}
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={onChange}
              keyboardType="number-pad"
              autoCapitalize="characters"
              maxLength={CODE_LEN}
              style={styles.hiddenInput}
              caretHidden
              onSubmitEditing={join}
              autoFocus
            />
          </Pressable>
          {err && <Text style={styles.err}>{err}</Text>}
          <Pressable disabled={busy} onPress={join} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>가게에 합류하기</Text>}
          </Pressable>
        </View>

        <View style={styles.helpBox}>
          <Text style={styles.helpBody}>
            코드가 없으신가요? 사장님께 코드를 요청하세요.{'\n'}
            <Text style={styles.helpStrong}>사장님: 설정 › 가게 관리</Text>에서 코드를 확인할 수 있어요.
          </Text>
        </View>

        <Pressable onPress={() => void logout()} style={styles.logoutRow}>
          <Text style={styles.logoutText}>다른 계정으로 로그인</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const CELL_GAP = 8;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 22 },
  hero: { alignItems: 'center', gap: 10 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: BrandColors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  sub: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  strong: { fontWeight: '800', color: InkColors.ink },

  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: InkColors.line, padding: 20, gap: 12 },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  cells: { flexDirection: 'row', gap: CELL_GAP, position: 'relative' },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 56,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: BrandColors.brand },
  cellText: { fontSize: 22, fontWeight: '900', color: BrandColors.brand },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent' },

  err: { fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  primary: { backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  helpBox: { backgroundColor: InkColors.bgSoft, borderRadius: 12, padding: 16 },
  helpBody: { fontSize: 13, color: InkColors.ink3, lineHeight: 20 },
  helpStrong: { fontWeight: '800', color: InkColors.ink2 },
  logoutRow: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
});
