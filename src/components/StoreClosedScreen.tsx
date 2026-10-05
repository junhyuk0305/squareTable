// StoreClosedScreen — 사장이 닫은(이전) 매장이 활성 매장인 직원·매니저에게 보이는 차단 화면(0284 · C2).
// 판정은 서버(my_unit_locked)가 갖고 세션 unitLocked 로 온다. 직원·사장 레이아웃이 Stack 대신 이 화면을 그린다.
// 다른 매장이 있으면 매장 목록으로 가는 길을 준다(목록은 레이아웃 밖이라 여기서 막히지 않는다).
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export function StoreClosedScreen() {
  const router = useRouter();
  const storeName = useSessionStore((s) => s.storeName);
  const stores = useSessionStore((s) => s.stores);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card} testID="store-closed">
        <Ionicons name="lock-closed-outline" size={28} color={InkColors.ink} />
        <Text style={styles.title}>사장님이 이 매장을 닫았어요</Text>
        <Text style={styles.body}>
          {storeName ? `“${storeName}” 매장은 지금 쓸 수 없어요. ` : '지금은 이 매장을 쓸 수 없어요. '}
          {stores.length > 1 ? '다른 매장으로 옮겨 주세요.' : '자세한 내용은 사장님께 문의해 주세요.'}
        </Text>
        {stores.length > 1 ? (
          <Pressable
            onPress={() => router.replace('/stores')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.88 }]}
          >
            <Text style={styles.btnText}>다른 매장으로 가기</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.push('/account-settings')} accessibilityRole="button" style={styles.linkBtn}>
          <Text style={styles.link}>계정 설정</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream, alignItems: 'center', justifyContent: 'center', padding: Space.xl },
  card: { alignItems: 'center', gap: Space.md, maxWidth: 420, padding: Space.xl, borderRadius: Radius.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: InkColors.line },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, color: InkColors.ink2, textAlign: 'center' },
  btn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.xl, borderRadius: Radius.md, backgroundColor: BrandColors.brand },
  btnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  linkBtn: { paddingVertical: Space.sm, paddingHorizontal: Space.md },
  link: { fontSize: 14, fontWeight: '700', color: InkColors.ink3, textDecorationLine: 'underline' },
});
