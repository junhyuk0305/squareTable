import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerOverview } from '@/components/owner/OwnerOverview';
import { PlanUpgradeNotice } from '@/components/PlanUpgradeNotice';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canUseMultistore } from '@/lib/config/tiers';
import { InkColors } from '@/lib/theme/colors';

/**
 * '전체 매장 보기'(다점포 통합뷰) — 내 전 매장의 미답질문·직원·노하우·인건비를 합계+매장별로.
 * 매장 전환 시트의 '전체 매장 한눈에 보기'에서 진입. 제목/백버튼은 owner/_layout.tsx 가 제공.
 * 다점포 요금제 전용(0062) — 무료·단일은 딥링크로 들어와도 업그레이드 안내(FREE_MODE 땐 전부 열림).
 */
export default function OwnerOverviewScreen() {
  const plan = useSessionStore((s) => s.plan);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {canUseMultistore(plan) ? (
        <OwnerOverview />
      ) : (
        <PlanUpgradeNotice description="전체 매장의 질문·직원·인건비를 한눈에 보는 통합뷰는 다점포 요금제 기능이에요." />
      )}
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
