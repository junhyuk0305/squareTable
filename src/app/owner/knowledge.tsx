import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { OwnerKnowhowBrowse } from '@/components/owner/OwnerKnowhowBrowse';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

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
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* J10(0248) 보관한 노하우 — 되살리기는 보관함에서 한다. */}
      <ScreenTitleHeader
        title="내 노하우"
        backFallback
        right={
          <Pressable
            onPress={() => router.push('/owner/knowhow-archive')}
            style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="보관함"
          >
            <Ionicons name="archive-outline" size={18} color={InkColors.ink2} />
            <Text style={styles.headerActionText}>보관함</Text>
          </Pressable>
        }
      />
      {/* ?review=1 = 홈 '점검할 노하우' 착지점 → '노하우' 칸 + '점검 필요' 탭(2026-08-27 §7-2).
          (2026-08-19~08-27 사이엔 '할 일' 칸으로 보냈다.) */}
      <OwnerKnowhowBrowse
        onSelect={openEntry}
        initialSegment={review === '1' ? 'knowhow' : undefined}
        initialListTab={review === '1' ? 'review' : undefined}
      />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  headerAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: Space.sm },
  headerActionText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
});
