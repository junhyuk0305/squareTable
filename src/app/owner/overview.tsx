import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerOverview } from '@/components/owner/OwnerOverview';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors } from '@/lib/theme/colors';

/**
 * '전체 매장 보기'(다점포 통합뷰) — 내 전 매장의 미답질문·직원·노하우·인건비를 합계+매장별로.
 * 매장 전환 시트의 '전체 매장 한눈에 보기'에서 진입. 제목/백버튼은 owner/_layout.tsx 가 제공.
 */
export default function OwnerOverviewScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <OwnerOverview />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
