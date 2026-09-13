import { StyleSheet } from 'react-native';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardShift } from '@/components/KeyboardShift';
import { OwnerKnowhowImport } from '@/components/owner/OwnerKnowhowImport';
import { PlanUpgradeNotice } from '@/components/PlanUpgradeNotice';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canUseMultistore } from '@/lib/config/tiers';
import { InkColors } from '@/lib/theme/colors';

/**
 * '노하우 복사하기'(다점포) — 내 한 매장의 발행 노하우를 **내 다른 매장으로** 복사하는 3단계 위저드.
 * 노하우 허브 '매장별 노하우' 카드에서 진입(매장 2+개일 때만 노출). 제목/백버튼은 owner/_layout.tsx 가 제공.
 * 2026-09-13: 진입 전 매장 선택 시트를 없앴다 — 보내는 매장·받는 매장을 1단계에서 둘 다 고르므로
 *   활성 매장을 미리 바꿀 이유가 없어졌다(고르기만 했는데 들어가 있는 매장이 바뀌던 부작용 제거).
 * 다점포 요금제 전용(0062) — 무료·단일은 딥링크로 들어와도 업그레이드 안내(전면 무료 기간엔 전부 열림).
 */
export default function OwnerImportKnowhowScreen() {
  const plan = useSessionStore((s) => s.plan);
  const freeMode = useSessionStore((s) => s.freeMode);
  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenTitleHeader title="노하우 복사하기" backFallback />
      {canUseMultistore(plan, freeMode) ? (
        <KeyboardShift>
          <OwnerKnowhowImport />
        </KeyboardShift>
      ) : (
        <PlanUpgradeNotice description="매장 간 노하우 복사는 다점포 요금제 기능이에요." />
      )}
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
