import { View, Text, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { RoleTabBar } from '@/components/RoleTabBar';
import { OwnerKnowhowBrowse } from '@/components/owner/OwnerKnowhowBrowse';
import { InkColors } from '@/lib/theme/colors';

/**
 * 노하우 탭(사장님) — 매장 노하우 대시보드 단일 화면.
 * 검색·카테고리 필터·가로 캐러셀·미검증 검증을 한 화면에서 처리한다(OwnerKnowhowBrowse).
 *
 * (이력) 옛 KnowhowSegment 3칸[둘러보기|물어보기|내노하우] → 2칸 → 세그먼트 폐지.
 * '물어보기' 세그먼트는 '받은질문' 탭으로 보내는 중복 진입점일 뿐이라 제거했다.
 * 사장님은 '묻는' 주체가 아니라 '답하는' 주체 — 받은 질문 답변은 하단 '받은질문' 탭이 전담한다.
 */
export default function OwnerCategoriesScreen() {
  const router = useRouter();

  // 카드를 탭하면 해당 노하우 수정으로 (검토/보강 흐름).
  const openEntry = (id: string) => router.push({ pathname: '/owner/edit/[id]', params: { id } });

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          // 탭 루트(뒤로가기 없음) — 네이티브 타이틀 앵커(~17px)를 콘텐츠 거터(20)로 맞춰
          // paddingLeft 3 = 20-17.
          headerTitleAlign: 'left',
          headerTitle: () => <Text style={styles.headerTitle}>노하우</Text>,
        }}
      />

      <OwnerKnowhowBrowse onSelect={openEntry} />
      <RoleTabBar role="owner" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: InkColors.cream },
  headerTitle: { paddingLeft: 3, fontSize: 16, fontWeight: '800', color: InkColors.ink },
});
