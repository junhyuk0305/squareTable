import { View, Text, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';

import { RoleTabBar } from '@/components/RoleTabBar';
import { OwnerKnowhowBrowse, type KnowhowSegKey } from '@/components/owner/OwnerKnowhowBrowse';
import { InkColors } from '@/lib/theme/colors';

const SEG_KEYS: KnowhowSegKey[] = ['todo', 'knowhow', 'unused'];

/**
 * 노하우 탭(사장님) — 할 일 · 노하우 · 안 쓰임 3칸(OwnerKnowhowBrowse).
 *
 * (이력) 옛 KnowhowSegment 3칸[둘러보기|물어보기|내노하우] → 2칸 → 세그먼트 폐지.
 * (2026-08-07) 받은질문 탭을 흡수하며 세그먼트가 [할 일|노하우|안 쓰임]으로 돌아왔다.
 * `?seg=todo` = 구 /owner/inbox 착지점(딥링크·푸시가 리다이렉트로 들어온다).
 */
export default function OwnerCategoriesScreen() {
  const router = useRouter();
  const { seg } = useLocalSearchParams<{ seg?: string }>();
  // 모르는 값이면 넘기지 않는다 — undefined면 컴포넌트가 기본 칸('노하우')을 쓴다.
  const initialSegment = SEG_KEYS.find((k) => k === seg);

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

      <OwnerKnowhowBrowse onSelect={openEntry} initialSegment={initialSegment} />
      <RoleTabBar role="owner" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: InkColors.cream },
  headerTitle: { paddingLeft: 3, fontSize: 16, fontWeight: '800', color: InkColors.ink },
});
