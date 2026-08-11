import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerKnowhowImport } from '@/components/owner/OwnerKnowhowImport';
import { PlanUpgradeNotice } from '@/components/PlanUpgradeNotice';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canUseMultistore } from '@/lib/config/tiers';
import { InkColors } from '@/lib/theme/colors';

/**
 * '다른 매장에서 가져오기'(다점포) — 내 다른 매장의 발행 노하우를 현재 매장으로 복제하는 백-가능 서브화면.
 * 홈 '우리 매장 노하우' 카드에서 진입(매장 2+개일 때만 노출). 제목/백버튼은 owner/_layout.tsx 가 제공.
 * 다점포 요금제 전용(0062) — 무료·단일은 딥링크로 들어와도 업그레이드 안내(전면 무료 기간엔 전부 열림).
 */
export default function OwnerImportKnowhowScreen() {
  const plan = useSessionStore((s) => s.plan);
  const freeMode = useSessionStore((s) => s.freeMode);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {canUseMultistore(plan, freeMode) ? (
        <OwnerKnowhowImport />
      ) : (
        <PlanUpgradeNotice description="다른 매장의 노하우를 이 매장으로 가져오는 기능은 다점포 요금제 기능이에요." />
      )}
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
