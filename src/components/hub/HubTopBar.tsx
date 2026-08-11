// 허브 공통 상단바 — 워드마크 + 알림 벨(통합 알림, ★기존 위치 고정 — 탭 금지가 사용자 확정) + 아바타(계정 설정).
// 허브 두 탭(현황/오늘·매장)이 공유한다 — stores.tsx 인라인이던 것을 공용화(복제 방지).
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { BellButton } from '@/components/NotificationBell';
import { AccountAvatarButton } from '@/components/AccountAvatarButton';
import { Wordmark } from '@/components/Wordmark';
import { Space } from '@/lib/theme/layout';

export function HubTopBar() {
  const router = useRouter();
  const { totalUnread } = useCrossNotifRows();

  return (
    <View style={styles.topbar}>
      <Wordmark size="sm" />
      <View style={styles.right}>
        <BellButton count={totalUnread} edge={false} onPress={() => router.push('/notifications')} />
        <AccountAvatarButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});
