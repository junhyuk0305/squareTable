import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, frameCapStyle } from '@/lib/theme/layout';

/**
 * 다점포 전용 화면의 요금제 가드(과금층 0062) — 무료·단일 요금제로 딥링크 진입 시
 * 빈 화면 대신 업그레이드 안내를 보여준다. 노출 판정은 canUseMultistore(tiers.ts) 한 곳,
 * 이 컴포넌트는 표시 전용. FREE_MODE(파일럿) 동안엔 판정이 항상 열려 있어 렌더되지 않는다.
 */
export function PlanUpgradeNotice({ description }: { description: string }) {
  const router = useRouter();
  return (
    <View style={[styles.center, frameCapStyle]}>
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed-outline" size={24} color={InkColors.ink2} />
      </View>
      <Text style={styles.title}>다점포 요금제에서 열려요</Text>
      <Text style={styles.desc}>{description}</Text>
      <Pressable
        onPress={() => router.push('/billing' as never)}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.88 }]}
        accessibilityRole="button"
        accessibilityLabel="요금제 보기"
      >
        <Text style={styles.ctaText}>요금제 보기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm, padding: Space.xl },
  iconWrap: {
    width: 52, height: 52, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Space.xs,
    borderWidth: 1, borderColor: InkColors.line, ...Elevation.e1,
  },
  title: { fontSize: 16, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  desc: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },
  cta: {
    marginTop: Space.md, backgroundColor: BrandColors.brand,
    paddingVertical: 12, paddingHorizontal: Space.xl, borderRadius: Radius.md,
  },
  ctaText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
