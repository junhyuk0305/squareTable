// 상단 헤더 우측 알림 벨 — 안 읽은 공지 + 나에게 온 교대 요청 수를 배지로.
// 탭하면 알림 화면(/junior/notifications)으로. 매장명·내 이름은 그 화면 맨 위에서 보여준다.
import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { todayStr } from '@/lib/utils/attendance';
import { juniorUnreadCount, ownerUnreadCount } from '@/lib/utils/notifications';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

/** 알림 벨(프레젠테이셔널) — 헤더 우측 공용. 배지 카운트·탭 동작은 호출부가 주입(사장·직원 공유).
 *  edge=true(기본): 네이티브 헤더용 우측 끝 여백(HEADER_EDGE_GUTTER). false: 자체 패딩 가진 커스텀 헤더용. */
export function BellButton({ count, onPress, edge = true }: { count: number; onPress: () => void; edge?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `알림 ${count}건` : '알림'}
      style={({ pressed }) => [styles.btn, !edge && { paddingLeft: 0, paddingRight: 0 }, pressed && { opacity: 0.6 }]}
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

/** 직원 알림 벨 — 배지 = 안 읽은 공지 + 받은 교대 요청 → /junior/notifications. */
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

  return <BellButton count={count} onPress={() => router.push('/junior/notifications')} />;
}

/** 사장 알림 벨 — 배지 = 답변대기 질문 + 검토대기 제안 + 승인대기 교대 → /owner/notifications. */
export function OwnerNotificationBell({ edge = true }: { edge?: boolean } = {}) {
  const router = useRouter();
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const swaps = useScheduleStore((s) => s.swaps);

  const count = useMemo(
    () => ownerUnreadCount(queue, suggestions, swaps),
    [queue, suggestions, swaps],
  );

  return <BellButton count={count} onPress={() => router.push('/owner/notifications')} edge={edge} />;
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
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
});
