import { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { NotificationList } from '@/components/NotificationList';
import { buildOwnerNotifications, type OwnerNotifKind } from '@/lib/utils/notifications';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** kind → 아이콘·틴트(데이터는 util SSOT, 표현만 여기서). */
const KIND_UI: Record<OwnerNotifKind, { icon: IconName; tint: string }> = {
  question: { icon: 'chatbubble-ellipses', tint: BrandColors.yellowSoft },
  suggestion: { icon: 'bulb', tint: BrandColors.brandSoft },
  swap_approval: { icon: 'swap-horizontal', tint: BrandColors.accentSoft },
};

/**
 * 사장 알림 화면 — 벨(OwnerNotificationBell)에서 진입.
 * 답변 대기 질문 · 알바 제안 · 승인 대기 교대를 시간 역순으로 모아 보여준다.
 * 데이터 모델·목록 렌더는 직원 알림과 공유(notifications util · NotificationList).
 */
export default function OwnerNotificationsScreen() {
  const router = useRouter();
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const swaps = useScheduleStore((s) => s.swaps);
  const staff = useStaffStore((s) => s.staff);

  const rows = useMemo(
    () =>
      buildOwnerNotifications({
        queue,
        suggestions,
        swaps,
        nameOf: (id) => staff.find((x) => x.id === id)?.name ?? '직원',
      }),
    [queue, suggestions, swaps, staff],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <NotificationList
          rows={rows}
          kindUI={KIND_UI}
          onPress={(r) => r.route && router.push(r.route as Href)}
          empty={{
            text: '지금 처리할 알림이 없어요.',
            sub: '받은 질문 · 제안 · 승인 대기 교대가 생기면 여기에 모아서 보여드려요.',
          }}
        />
        <View style={{ height: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },
});
