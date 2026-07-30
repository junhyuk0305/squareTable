// 허브 공통 상단바 — 워드마크 + 알림 벨(통합 알림, ★기존 위치 고정 — 탭 금지가 사용자 확정) + 아바타(계정 설정).
// 허브 두 탭(현황/오늘·매장)이 공유한다 — stores.tsx 인라인이던 것을 공용화(복제 방지).
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { BellButton } from '@/components/NotificationBell';
import { Wordmark } from '@/components/Wordmark';
import { InkColors } from '@/lib/theme/colors';
import { Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export function HubTopBar() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const { totalUnread } = useCrossNotifRows();

  return (
    <View style={styles.topbar}>
      <Wordmark size="sm" />
      <View style={styles.right}>
        <BellButton count={totalUnread} edge={false} onPress={() => router.push('/notifications')} />
        <Pressable
          onPress={() => router.push('/account-settings')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="내 계정 · 설정"
          style={({ pressed }) => [styles.avaBtn, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(userName || '?').slice(0, 1)}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  avaBtn: { padding: 2 },
  // 설정 진입점(프로필 앞글자) — 흰 테두리 + 그림자(입체)로 "누르는 버튼"임을 드러낸다.
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...Elevation.e2,
  },
  avatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
