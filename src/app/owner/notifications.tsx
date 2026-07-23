import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { showToast } from '@/lib/store/useToastStore';
import { Appear } from '@/components/Appear';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { NotificationList, OWNER_KIND_UI } from '@/components/NotificationList';
import { NotificationEnableCard } from '@/components/NotificationEnableCard';
import { SegmentTabs } from '@/components/SegmentTabs';
import { buildOwnerNotifications } from '@/lib/utils/notifications';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

// kind → 아이콘·틴트 매핑은 NotificationList 의 OWNER_KIND_UI 공유(허브 통합 알림과 재정의 금지).
const KIND_UI = OWNER_KIND_UI;

/**
 * 사장 알림 화면 — 벨(OwnerNotificationBell)에서 진입.
 * 답변 대기 질문 · 알바 제안 · 승인 대기 교대를 시간 역순으로 모아 보여준다.
 * 데이터 모델·목록 렌더는 직원 알림과 공유(notifications util · NotificationList).
 */
export default function OwnerNotificationsScreen() {
  const router = useRouter();
  const me = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName) || '우리 가게';
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const swaps = useScheduleStore((s) => s.swaps);
  const staff = useStaffStore((s) => s.staff);
  const pending = useStaffStore((s) => s.pending);
  const feed = useWorkStore((s) => s.feed);
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);
  const markAllRead = useWorkStore((s) => s.markAllRead);

  // 화면에 들어올 때마다 명부·합류신청을 다시 당겨온다. profiles 실시간이 없어도(또는 앱을 켜둔 채로
  // 신청이 들어와도) 사장이 이 화면을 열면 최신 합류 신청이 반드시 보이게 하는 안전장치.
  useFocusEffect(useCallback(() => { useStaffStore.getState().hydrate(); }, []));

  // ── 통합 알림(전체 매장, 0077) — 다점포 소유일 때만 세그먼트 노출.
  //    판정·매핑·탭 동작(전환 후 읽음처리 포함)은 공용 훅(useCrossNotifRows) SSOT.
  const sessionStores = useSessionStore((s) => s.stores);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const multiStore = sessionStores.length > 1;
  const [seg, setSeg] = useState<'store' | 'all'>('store');
  useEffect(() => {
    if (multiStore) void hydrateCross();
  }, [multiStore, hydrateCross]);
  const { listRows: allRows, totalUnread: allUnread, openRow } = useCrossNotifRows();

  const initial = (userName ?? '나').trim().slice(0, 1) || '나';

  const rows = useMemo(
    () =>
      buildOwnerNotifications({
        queue,
        suggestions,
        swaps,
        pending,
        nameOf: (id) => staff.find((x) => x.id === id)?.name ?? '직원',
        feed,
        userId: me,
      }),
    [queue, suggestions, swaps, pending, staff, feed, me],
  );

  // '전체 읽음' 대상 = 읽을 수 있는(멘션) 안 읽은 알림. 합류·질문·제안·교대는 '처리'로 사라지는 실행 항목이라 제외.
  const unreadReadIds = useMemo(
    () => rows.filter((r) => r.unread && r.readFeedId).map((r) => r.readFeedId as string),
    [rows],
  );

  function markAll() {
    if (unreadReadIds.length === 0) return;
    markAllRead(unreadReadIds, me);
    showToast('모두 읽음 처리했어요', 'good');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        // 전체 읽음은 활성 매장 것만 가능(다른 매장 read_by 는 RLS 스코프 밖) → '이 매장' 탭에서만.
        options={{ headerRight: () => (seg === 'store' && unreadReadIds.length > 0 ? <MarkAllReadButton onPress={markAll} /> : null) }}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 맨 위 — 매장명 · 사장님 이름(정체성). 직원 알림 화면과 동일 구조 */}
        <Appear delay={0}>
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
        </Appear>

        <NotificationEnableCard />

        {/* 다점포 소유면 '이 매장 | 전체 매장' 세그먼트(0077 통합 알림) */}
        {multiStore && (
          <SegmentTabs
            style={{ margin: 0 }}
            items={[
              { key: 'store', label: '이 매장' },
              { key: 'all', label: '전체 매장', count: allUnread },
            ]}
            value={seg}
            onChange={(k) => setSeg(k as 'store' | 'all')}
          />
        )}

        <Appear delay={80}>
        {seg === 'all' && multiStore ? (
          <NotificationList
            rows={allRows}
            kindUI={KIND_UI}
            onPress={(r) => void openRow(r)}
            empty={{
              text: '전체 매장에 처리할 알림이 없어요.',
              sub: '소유한 모든 매장의 합류 신청·질문·제안·교대를 여기에 모아서 보여드려요.',
            }}
          />
        ) : (
          <NotificationList
            rows={rows}
            kindUI={KIND_UI}
            onPress={(r) => {
              if (r.readFeedId) markNoticeRead(r.readFeedId, me); // 멘션은 탭하면 읽음 처리
              if (r.route) router.push(r.route as Href);
            }}
            empty={{
              text: '지금 처리할 알림이 없어요.',
              sub: '합류 신청 · 받은 질문 · 제안 · 승인 대기 교대가 생기면 여기에 모아서 보여드려요.',
            }}
          />
        )}
        </Appear>
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
