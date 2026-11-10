import { useCallback, useState } from 'react';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { SettingsSection, SettingsRow } from '@/components/settings/SettingsKit';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { aiQuotaStatusAt, type AiQuotaStatus } from '@/lib/db';
import { track } from '@/lib/analytics/track';
import { notifyAction } from '@/lib/utils/confirm';
import { SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';

/**
 * S06 공간 설정(주인) — 공간 이름 · AI 사용량(이번 달 n / 300) · 더 쓰기 · 매장으로 돌아가기.
 * 더 쓰기 = v1 결제 없음. 누른 수만 센다(space_more_use_tapped) → 안내 한 장. 멤버·초대·공간 삭제는 4번 덩이.
 */
export default function SpaceSettings() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const leaveSpace = useSessionStore((s) => s.leaveSpace);
  const [quota, setQuota] = useState<AiQuotaStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!spaceId) return;
      let alive = true;
      // 못 읽으면 행을 그리지 않는다(0건으로 위장하지 않는다 · 매장 설정과 같은 규칙).
      void aiQuotaStatusAt(spaceId).then(({ data }) => {
        if (alive) setQuota(data);
      });
      return () => {
        alive = false;
      };
    }, [spaceId]),
  );

  const moreUse = () => {
    const used = quota?.used ?? 0;
    const cap = quota?.cap ?? 0;
    track('space_more_use_tapped', { used, cap, used_pct: cap > 0 ? Math.round((used / cap) * 100) : 0 });
    void notifyAction(SPACE_SCREEN.moreUseTitle, SPACE_WORDS.moreUseSoon, '확인', { icon: 'sparkles-outline' });
  };

  const backToStores = () => {
    leaveSpace();
    router.replace('/stores');
  };

  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabSettings} line={spaceName} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      <SettingsSection>
        <SettingsRow first icon="library-outline" label={SPACE_SCREEN.settingsName} value={spaceName} />
      </SettingsSection>
      <SettingsSection>
        {quota ? (
          <SettingsRow
            first
            icon="sparkles-outline"
            label={SPACE_SCREEN.settingsAi}
            hint={SPACE_SCREEN.settingsAiHint}
            value={`${quota.used.toLocaleString()} / ${quota.cap.toLocaleString()}`}
          />
        ) : null}
        <SettingsRow
          first={!quota}
          icon="add-circle-outline"
          label={SPACE_WORDS.moreUse}
          hint={SPACE_SCREEN.settingsMoreHint}
          onPress={moreUse}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          first
          icon="storefront-outline"
          label={SPACE_SCREEN.settingsBack}
          hint={SPACE_SCREEN.settingsBackHint}
          onPress={backToStores}
        />
      </SettingsSection>
    </Screen>
  );
}
