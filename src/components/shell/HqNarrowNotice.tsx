import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { HQ_TO_STORE_LABEL } from '@/lib/nav/landing';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 본사 화면을 좁은 폰 브라우저로 열었을 때의 안내 한 장(J15 ④ · 2026-10-05).
 * 본사 화면은 넓은 웹 전용이라 좁으면 깨져 보인다. 넓은 화면은 지금 그대로다(AppShell.web 의 hqNarrow).
 */
export function HqNarrowNotice() {
  const router = useRouter();
  const hasStore = useSessionStore((s) => s.stores.length > 0);
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Ionicons name="desktop-outline" size={28} color={InkColors.ink} />
        <Text style={styles.title}>컴퓨터에서 열어 주세요</Text>
        <Text style={styles.body}>본사 화면은 넓은 화면 전용이에요. 컴퓨터 브라우저로 열면 대시보드가 보여요.</Text>
        {hasStore && (
          <Pressable onPress={() => router.replace('/hub')} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.btnText}>{HQ_TO_STORE_LABEL}</Text>
          </Pressable>
        )}
        <Pressable onPress={() => void logout()} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.btnSub, pressed && { opacity: 0.85 }]}>
          <Text style={[styles.btnText, styles.btnSubText]}>로그아웃</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, backgroundColor: InkColors.cream },
  card: { alignItems: 'center', gap: Space.md, maxWidth: 420, padding: Space.xl, borderRadius: Radius.md, backgroundColor: InkColors.bg },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  body: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  btn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.xl, borderRadius: Radius.pill, backgroundColor: BrandColors.brand },
  btnSub: { backgroundColor: 'transparent', borderWidth: 1, borderColor: InkColors.line },
  btnText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
  btnSubText: { color: InkColors.ink },
});
