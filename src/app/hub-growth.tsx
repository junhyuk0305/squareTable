import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { HAS_SUPABASE } from '@/lib/supabase';
import { HubTopBar } from '@/components/hub/HubTopBar';
import { HubTabBar } from '@/components/HubTabBar';
import { JuniorGrowthView } from '@/components/hub/JuniorGrowthView';
import { OwnerKnowhowHubView } from '@/components/hub/OwnerKnowhowHubView';
import { Appear } from '@/components/Appear';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

// ── 허브 2번째 탭: 축적·순환 레이어(3탭 확장, 2026-07-30) ─────────────────────────────
// 직원 '성장' — 내가 남긴 것(노하우·참조·채택·해본 업무) / 사장 '노하우' — 지식 신선도
// (노하우로 만들 것·검증 필요·오래 손 안 댄 것). 라우트 경로는 UI 텍스트가 아니다.
// 랜딩은 여전히 /hub(오늘·현황) — 이 탭은 능동적으로 들어오는 축적 공간(뱃지 없음).
export default function HubGrowthScreen() {
  const role = useSessionStore((s) => s.role);
  const status = useSessionStore((s) => s.status);
  const phone = useSessionStore((s) => s.phone);
  const unitId = useSessionStore((s) => s.unitId);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const sessionStores = useSessionStore((s) => s.stores);

  const isOwner = role === 'owner';

  // 게이트(hub.tsx 와 동일 규칙) — 루트 레벨이라 owner/junior 그룹 게이트를 안 탄다.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }
  if (sessionStores.length === 0 && !unitId) return <Redirect href="/stores" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <HubTopBar />
        <Appear delay={0}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{isOwner ? '노하우' : '성장'}</Text>
            <Text style={styles.subtitle}>
              {isOwner ? '매장 지식이 지금도 맞는지 챙기는 곳이에요' : '내가 남긴 것이 쌓이는 곳이에요'}
            </Text>
          </View>
        </Appear>
        {isOwner ? <OwnerKnowhowHubView /> : <JuniorGrowthView />}
      </ScrollView>
      <HubTabBar role={isOwner ? 'owner' : 'junior'} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.lg, paddingBottom: 40 },
  titleBlock: { gap: 4 },
  title: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: InkColors.ink2 },
});
