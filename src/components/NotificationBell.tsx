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
import { useStaffStore } from '@/lib/store/useStaffStore';
import { usePaymentClaimStore } from '@/lib/store/usePaymentClaimStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { todayStr } from '@/lib/utils/attendance';
import { juniorUnreadCount, managerUnreadCount, ownerUnreadCount } from '@/lib/utils/notifications';
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
export function NotificationBell({ edge = true }: { edge?: boolean } = {}) {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const swaps = useScheduleStore((s) => s.swaps);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const unitId = useSessionStore((s) => s.unitId);
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));
  const today = todayStr();

  const count = useMemo(
    () => juniorUnreadCount(feed, swaps, userId, today, templates, done, ackAt, suggestions),
    [feed, swaps, userId, today, templates, done, ackAt, suggestions],
  );

  return <BellButton count={count} edge={edge} onPress={() => router.push('/junior/notifications')} />;
}

/** 사장·매니저 알림 벨 — 배지 = 합류 승인대기 + 답변대기 질문 + 검토대기 제안 + 승인대기 교대
 *  (+ 매니저는 나에게 온 것: 공지·배정·내 제안 결과) → /owner/notifications.
 *  배지와 목록(owner/notifications.tsx)이 **같은 축**을 봐야 하므로 역할 분기를 여기서도 그대로 한다. */
export function OwnerNotificationBell({ edge = true }: { edge?: boolean } = {}) {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const role = useSessionStore((s) => s.role);
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const swaps = useScheduleStore((s) => s.swaps);
  const pending = useStaffStore((s) => s.pending);
  const staff = useStaffStore((s) => s.staff);
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const claims = usePaymentClaimStore((s) => s.claims);
  const unitId = useSessionStore((s) => s.unitId);
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));
  const today = todayStr();

  const count = useMemo(() => {
    const base = ownerUnreadCount(queue, suggestions, swaps, pending, feed, userId, ackAt, claims);
    if (role !== 'manager') return base;
    return managerUnreadCount(base, {
      feed,
      taskTemplates: templates,
      done,
      today,
      suggestions,
      userId,
      nameOf: (id) => staff.find((x) => x.id === id)?.name ?? '직원',
      ackAt,
    });
  }, [queue, suggestions, swaps, pending, feed, userId, ackAt, claims, role, templates, done, today, staff]);

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
    backgroundColor: BrandColors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
});
