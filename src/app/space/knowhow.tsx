import { Stack } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { EmptyState } from '@/components/EmptyState';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SPACE_SCREEN } from '@/lib/place/words';

/** S04 공간 노하우 탭 — 빈 자리. 목록·쓰기(S07)·상세(S08)는 다음 에이전트가 채운다. 노하우 읽기는 fetchEntries(..., spaceId). */
export default function SpaceKnowhow() {
  const spaceName = useSessionStore((s) => s.spaceName);
  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabKnowhow} line={spaceName} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      <EmptyState title={SPACE_SCREEN.tabKnowhow} body={SPACE_SCREEN.soonBody} />
    </Screen>
  );
}
