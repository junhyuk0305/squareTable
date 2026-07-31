// 존재하지 않는 주소로 들어온 경우의 안내 화면 (expo-router 예약 라우트).
// 이전에는 프레임워크 기본 Unmatched 화면(영문·무스타일)에 의존해 사용자가 미아가 됐다 —
// 앱 스타일로 "무슨 일 + 뭘 하면 되는지"를 알려주고 홈으로 보낸다(루트 게이트가 역할별 착지 처리).
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.body}>
        <View style={styles.icon}>
          <Ionicons name="compass-outline" size={28} color={InkColors.ink2} />
        </View>
        <Text style={styles.title}>찾을 수 없는 화면이에요</Text>
        <Text style={styles.sub}>주소가 바뀌었거나 삭제된 화면이에요. 홈에서 다시 시작해 주세요.</Text>
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }]}
        >
          <Text style={styles.primaryText}>홈으로 가기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.gutter, gap: Space.md },
  icon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  sub: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, textAlign: 'center', maxWidth: 280 },
  primary: { marginTop: Space.sm, backgroundColor: BrandColors.brand, paddingVertical: 15, paddingHorizontal: Space.xl, borderRadius: Radius.md, alignItems: 'center', minWidth: 200 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
