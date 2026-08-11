// 허브 공통 상단바 — 2칸 토글 + 알림 벨(통합 알림, ★기존 위치 고정 — 탭 금지가 사용자 확정) + 아바타(계정 설정).
// 허브 두 탭(현황/오늘·매장)이 공유한다 — stores.tsx 인라인이던 것을 공용화(복제 방지).
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { BellButton } from '@/components/NotificationBell';
import { AccountAvatarButton } from '@/components/AccountAvatarButton';
import { StoreToggle } from '@/components/StoreToggle';
import { Space } from '@/lib/theme/layout';

export function HubTopBar() {
  const router = useRouter();
  const { totalUnread } = useCrossNotifRows();

  return (
    <View style={styles.topbar}>
      {/* 매장 층과 같은 2칸 토글 — 허브에선 로고 칸에 흰 면이 오고 스코프는 '전체 매장'이다(2026-08-08). */}
      <StoreToggle scope="hub" />
      <View style={styles.right}>
        <BellButton count={totalUnread} edge={false} onPress={() => router.push('/notifications')} />
        <AccountAvatarButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // zIndex — 매장 드롭다운이 아래 콘텐츠 위로 겹쳐 열린다. 상단바가 형제보다 위에 그려져야 한다.
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});
