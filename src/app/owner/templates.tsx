import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TemplateLibrary } from '@/components/owner/TemplateLibrary';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors } from '@/lib/theme/colors';

/**
 * '노하우 템플릿 둘러보기' — 업종 표준 템플릿을 검색하고 내 노하우로 가져오는 백-가능 서브화면.
 * 설정·홈 배너에서 진입(router.push). 제목/백버튼은 owner/_layout.tsx 의 templates Stack.Screen +
 * 전역 HeaderBackButton 가 제공한다.
 */
export default function OwnerTemplatesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <TemplateLibrary />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
