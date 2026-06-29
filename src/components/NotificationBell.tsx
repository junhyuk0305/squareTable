// 상단 헤더 우측 알림 벨 — 안 읽은 공지 + 나에게 온 교대 요청 수를 배지로.
// 탭하면 알림 화면(/junior/notifications)으로. 매장명·내 이름은 그 화면 맨 위에서 보여준다.
import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { todayStr } from '@/lib/utils/attendance';
import { juniorUnreadCount } from '@/lib/utils/notifications';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

/** 직원 알림 벨 — 헤더 우측(headerRight)에 둔다. 배지 = 안 읽은 공지 + 받은 교대 요청. */
export function NotificationBell() {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const feed = useWorkStore((s) => s.feed);
  const swaps = useScheduleStore((s) => s.swaps);
  const today = todayStr();

  const count = useMemo(
    () => juniorUnreadCount(feed, swaps, userId, today),
    [feed, swaps, userId, today],
  );

  return (
    <Pressable
      onPress={() => router.push('/junior/notifications')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `알림 ${count}건` : '알림'}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={23} color={InkColors.ink} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 우측 끝에서 콘텐츠 거터(HEADER_EDGE_GUTTER)만큼 안쪽으로 — 좌측 back 화살표와 좌우 대칭.
  btn: { paddingLeft: 14, paddingRight: HEADER_EDGE_GUTTER, paddingVertical: 4 },
  badge: {
    position: 'absolute',
    top: -1,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 99,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
});
