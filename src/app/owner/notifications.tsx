import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { NotificationList } from '@/components/NotificationList';
import { buildOwnerNotifications, type OwnerNotifKind } from '@/lib/utils/notifications';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
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
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName) || '우리 가게';
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const swaps = useScheduleStore((s) => s.swaps);
  const staff = useStaffStore((s) => s.staff);

  const initial = (userName ?? '나').trim().slice(0, 1) || '나';

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
        {/* 맨 위 — 매장명 · 사장님 이름(정체성). 직원 알림 화면과 동일 구조 */}
        <View style={styles.idCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.idStore} numberOfLines={1}>
              {storeName}
            </Text>
            <Text style={styles.idUser} numberOfLines={1}>
              {userName} 사장님
            </Text>
          </View>
        </View>

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

  // 정체성 카드 — 직원 알림 화면(junior/notifications)과 동일 규격
  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...Elevation.e1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '900', color: '#FFFFFF' },
  idStore: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  idUser: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, marginTop: 2 },
});
