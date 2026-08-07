import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { OwnerKnowhowBrowse } from '@/components/owner/OwnerKnowhowBrowse';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors } from '@/lib/theme/colors';

/**
 * '내 노하우' — 노하우 탭과 같은 목록을 보여주는 백-가능 서브화면.
 * 홈·설정의 '내 노하우' 진입점(router.push)에서 들어오므로, 탭 루트(categories)로 리다이렉트하면
 * 뒤로가기 화살표가 사라져 길이 막힌다 → 동일 컴포넌트를 서브화면으로 재사용해 헤더 백버튼을 유지한다.
 * (제목/백버튼은 owner/_layout.tsx 의 knowledge Stack.Screen + 전역 HeaderBackButton 가 제공)
 */
export default function OwnerKnowledgeScreen() {
  const router = useRouter();
  const { review } = useLocalSearchParams<{ review?: string }>();
  const openEntry = (id: string) => router.push({ pathname: '/owner/edit/[id]', params: { id } });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* ?review=1 = 홈 '확인이 필요한 노하우' 착지점. 미검증 배너·상태 칩이 사라진 대신
          그 수를 세는 '안 쓰임' 칸으로 보낸다(2026-08-07) — 링크가 죽지 않게. */}
      <OwnerKnowhowBrowse onSelect={openEntry} initialSegment={review === '1' ? 'unused' : undefined} />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
});
