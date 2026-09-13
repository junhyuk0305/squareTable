import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, frameCapStyle } from '@/lib/theme/layout';
import { showBillingEntry } from '@/lib/config/store-policy';
import { useSessionStore } from '@/lib/store/useSessionStore';

/**
 * 다점포 전용 화면의 요금제 가드(과금층 0062) — 무료·단일 요금제로 딥링크 진입 시
 * 빈 화면 대신 업그레이드 안내를 보여준다. 노출 판정은 canUseMultistore(tiers.ts) 한 곳,
 * 이 컴포넌트는 표시 전용. 전면 무료 기간엔 판정이 항상 열려 있어 렌더되지 않는다.
 */
export function PlanUpgradeNotice({ description }: { description: string }) {
  const router = useRouter();
  const freeMode = useSessionStore((s) => s.freeMode);
  const iapEnabled = useSessionStore((s) => s.iapEnabled);
  const entry = showBillingEntry(iapEnabled, freeMode);
  return (
    <View style={[styles.center, frameCapStyle]}>
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed-outline" size={24} color={InkColors.ink2} />
      </View>
      {/* 결제 경로가 없는 빌드에서만 사실 고지로 끝낸다 — 잠긴 기능을 보여주면서 푸는 길이 없으면
          막다른 길이다(2026-09-12 애플 3.1.3(c) 지적의 자리). 판정은 store-policy 한 곳.
          ⛔ 여기에 금액을 적지 않는다 — 웹 가격과 앱 가격이 다르다. 가격은 도착지가 말한다. */}
      <Text style={styles.title}>{entry ? '다점포 요금제에서 열려요' : '이 매장에서는 쓸 수 없어요'}</Text>
      <Text style={styles.desc}>{entry ? description : '여러 매장을 함께 관리할 때 쓰는 기능이에요.'}</Text>
      {entry && (
        <Pressable
          onPress={() => router.push('/billing' as never)}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel="요금제 보기"
        >
          <Text style={styles.ctaText}>요금제 보기</Text>
        </Pressable>
      )}
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
  desc: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, textAlign: 'center', lineHeight: 22 },
  cta: {
    marginTop: Space.md, backgroundColor: BrandColors.brand,
    paddingVertical: 12, paddingHorizontal: Space.xl, borderRadius: Radius.md,
  },
  ctaText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
