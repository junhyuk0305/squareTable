import { Stack } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SPACE_SCREEN } from '@/lib/place/words';

/** S05 공간 교육 탭 — 빈 자리. 답할 질문 목록·답하기(S09)는 다음 에이전트가, 교육 링크는 3번 덩이가 채운다. */
export default function SpaceTeach() {
  const spaceName = useSessionStore((s) => s.spaceName);
  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabTeach} line={spaceName} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      <EmptyState title={SPACE_SCREEN.tabTeach} body={SPACE_SCREEN.soonBody} />
    </Screen>
  );
}
