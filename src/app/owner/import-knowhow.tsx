import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerKnowhowImport } from '@/components/owner/OwnerKnowhowImport';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors } from '@/lib/theme/colors';

/**
 * '다른 매장에서 가져오기'(다점포) — 내 다른 매장의 발행 노하우를 현재 매장으로 복제하는 백-가능 서브화면.
 * 홈 '우리 매장 노하우' 카드에서 진입(매장 2+개일 때만 노출). 제목/백버튼은 owner/_layout.tsx 가 제공.
 */
export default function OwnerImportKnowhowScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <OwnerKnowhowImport />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
