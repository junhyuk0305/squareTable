// 헤더 좌측 뒤로가기 — 현재 네비게이터에 이전 화면이 있으면 back, 없으면(웹 새로고침·딥링크) 역할별 홈으로.
// ⚠️ 전역 router.canGoBack()은 부모(루트) 스택까지 포함해 true가 되어, 그룹의 첫 화면에서 back이
//    엉뚱한 상위 라우트(/stores 등)로 새어 나갔다(#14). 그래서 가장 가까운 네비게이터(useNavigation)
//    기준으로만 판정한다 — 이 그룹에서 뒤로 갈 곳이 없으면 back 대신 fallback 홈으로.
// 네이티브 스택 기본 back은 canGoBack()이 false면 사라져, 탭바 없는 서브화면에서 갇히는
// 문제가 있었다. 이 버튼은 항상 보이며 어디서든 탈출 경로를 보장한다.
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useNavigation, type Href } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors } from '@/lib/theme/colors';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

export function HeaderBackButton({ fallback }: { fallback?: Href }) {
  const router = useRouter();
  const navigation = useNavigation();
  const role = useSessionStore((s) => s.role);
  const status = useSessionStore((s) => s.status);
  const home: Href = fallback ?? (status !== 'signed_in' ? '/' : role === 'owner' ? '/owner/dashboard' : '/junior/home');

  return (
    <Pressable
      onPress={() => (navigation.canGoBack() ? navigation.goBack() : router.replace(home))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="뒤로"
      // 좌측 여백을 버튼 자체에 둔다(native-stack은 headerLeftContainerStyle 미지원).
      // 화살표가 콘텐츠 거터(HEADER_EDGE_GUTTER)에 맞게 떨어지도록 — 우측 액션과 좌우 대칭.
      style={({ pressed }) => [{ paddingLeft: HEADER_EDGE_GUTTER, paddingRight: 14, paddingVertical: 4, opacity: pressed ? 0.5 : 1 }]}
    >
      <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
    </Pressable>
  );
}
