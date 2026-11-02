import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { OwnerKnowhowBrowse } from '@/components/owner/OwnerKnowhowBrowse';
import { Screen } from '@/components/Screen';

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
    // 바탕·탭바 = Screen. 목록이 자기 스크롤을 가져 scroll={false}(노하우 탭과 같은 부품).
    <Screen header={<ScreenTitleHeader title="내 노하우" backFallback />} tabBar="owner" scroll={false}>
      {/* ?review=1 = 홈 '점검할 노하우' 착지점 → '노하우' 칸 + '점검 필요' 탭(2026-08-27 §7-2).
          (2026-08-19~08-27 사이엔 '할 일' 칸으로 보냈다.) */}
      <OwnerKnowhowBrowse
        onSelect={openEntry}
        initialSegment={review === '1' ? 'knowhow' : undefined}
        initialListTab={review === '1' ? 'review' : undefined}
      />
    </Screen>
  );
}
