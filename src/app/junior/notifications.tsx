import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { showToast } from '@/lib/store/useToastStore';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { Appear } from '@/components/Appear';
import { NotificationList } from '@/components/NotificationList';
import { NotificationEnableCard } from '@/components/NotificationEnableCard';
import { SegmentTabs } from '@/components/SegmentTabs';
import { todayStr } from '@/lib/utils/attendance';
import { buildJuniorNotifications, type JuniorNotifKind } from '@/lib/utils/notifications';
import { buildStoreNotifs, mergeCrossNotifs, storeUnreadCount, type CrossNotifRow } from '@/lib/utils/crossStoreNotifs';
import { storeColor } from '@/lib/utils/storeColor';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** kind → 아이콘·틴트 매핑(데이터는 순수 util에서, UI 표현만 여기서). */
const KIND_UI: Record<JuniorNotifKind, { icon: IconName; tint: string }> = {
  notice: { icon: 'megaphone', tint: BrandColors.yellowSoft },
  mention: { icon: 'at', tint: BrandColors.brandSoft },
  assign: { icon: 'clipboard', tint: BrandColors.yellowSoft },
  swap: { icon: 'swap-horizontal', tint: BrandColors.accentSoft },
  swap_approved: { icon: 'checkmark-circle', tint: '#E4F2E8' },
  swap_rejected: { icon: 'close-circle', tint: BrandColors.accentSoft },
};

/**
 * 직원 알림 화면 — 벨(NotificationBell)에서 진입.
 * 맨 위에 매장명·내 이름(정체성)을 보여주고, 그 아래로 알림을 시간 역순으로.
 * 알림 = 안 읽은/지난 공지 · 나를 언급한 글 · 받은 교대 요청 · 내 교대 요청 결과.
 * (실서비스 알림함 관행: 우상단 벨 → 풀스크린 목록, who·what·when 한눈에 + 탭하면 해당 화면으로)
 */
export default function JuniorNotificationsScreen() {
  const router = useRouter();
  const me = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName) || '우리 가게';

  const feed = useWorkStore((s) => s.feed);
  const taskTemplates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);
  const markAllRead = useWorkStore((s) => s.markAllRead);
  const swaps = useScheduleStore((s) => s.swaps);
  const templates = useScheduleStore((s) => s.templates);
  const staff = useStaffStore((s) => s.staff);
  const today = todayStr();

  // ── 통합 알림(전체 매장, 0077) — 다점포 소속일 때만 세그먼트 노출 ──
  const unitId = useSessionStore((s) => s.unitId);
  const sessionStores = useSessionStore((s) => s.stores);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const crossData = useCrossNotifStore((s) => s.data);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const multiStore = sessionStores.length > 1;
  const [seg, setSeg] = useState<'store' | 'all'>('store');
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (multiStore) void hydrateCross();
  }, [multiStore, hydrateCross]);

  const labelOf = (uid: string) =>
    prefFor(uid).nickname || sessionStores.find((u) => u.unit_id === uid)?.store_name || '매장';
  const { allRows, allUnread } = useMemo(() => {
    const roleOf = (uid: string) => sessionStores.find((u) => u.unit_id === uid)?.role ?? 'junior';
    return {
      allRows: mergeCrossNotifs(crossData.map((d) => buildStoreNotifs(d, roleOf(d.unitId), me, today))),
      allUnread: crossData.reduce((n, d) => n + storeUnreadCount(d, roleOf(d.unitId), me, today), 0),
    };
  }, [crossData, sessionStores, me, today]);

  // 다른 매장 알림 탭 = 그 매장으로 활성 전환 후 이동.
  // 읽음처리: 크로스 행은 전환 완료 후(그 매장이 활성 = wf_update RLS 통과) cross 스토어가 직접 DB 기록,
  //   활성 매장 행은 기존 경로(workStore.markNoticeRead)가 DB 를 쓰고 cross 뱃지는 로컬만 동기화.
  const markCrossRead = useCrossNotifStore((s) => s.markFeedRead);
  async function openCrossRow(r: CrossNotifRow) {
    if (switching) return;
    if (r.unitId !== unitId) {
      setSwitching(true);
      await switchUnit(r.unitId);
      setSwitching(false);
      if (r.readFeedId) void markCrossRead(r.unitId, r.readFeedId, me);
    } else if (r.readFeedId) {
      markNoticeRead(r.readFeedId, me);
      void markCrossRead(r.unitId, r.readFeedId, me, false);
    }
    router.push(r.route as Href);
  }

  const rows = useMemo(
    () =>
      buildJuniorNotifications({
        feed,
        swaps,
        templates,
        nameOf: (id) => (id === me ? '나' : staff.find((x) => x.id === id)?.name ?? '동료'),
        userId: me,
        today,
        taskTemplates,
        done,
      }),
    [feed, swaps, templates, staff, me, today, taskTemplates, done],
  );

  const initial = (userName ?? '나').trim().slice(0, 1) || '나';

  // '전체 읽음' 대상 = 읽을 수 있는(공지·멘션) 안 읽은 알림의 피드 id. 배정·교대는 read 개념이 없어 제외.
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
        options={{
          title: '알림',
          headerLeft: () => <HeaderBackButton fallback="/junior/home" />,
          // 전체 읽음은 활성 매장 것만 가능(다른 매장 read_by 는 RLS 스코프 밖) → '이 매장' 탭에서만.
          headerRight: () => (seg === 'store' && unreadReadIds.length > 0 ? <MarkAllReadButton onPress={markAll} /> : null),
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 맨 위 — 매장명 · 내 이름(정체성). 홈 헤더에서 옮겨온 정보 */}
        {/* 카드 자체가 '내 계정' 진입점 — 누르면 프로필 편집 화면으로(설정 탭 프로필 카드와 동일 목적지). */}
        <Appear delay={0}>
        <Pressable
          onPress={() => router.push('/account-edit')}
          style={({ pressed }) => [styles.idCard, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="내 계정 — 프로필 편집"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.idStore} numberOfLines={1}>
              {storeName}
            </Text>
            <Text style={styles.idUser} numberOfLines={1}>
              {userName}님
            </Text>
          </View>
        </Pressable>
        </Appear>

        <NotificationEnableCard />

        {/* 다점포 소속이면 '이 매장 | 전체 매장' 세그먼트(0077 통합 알림) */}
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

        {/* 알림 목록 — 직원·사장 공유 NotificationList */}
        <Appear delay={80}>
        {seg === 'all' && multiStore ? (
          <NotificationList
            rows={allRows.map((r) => ({
              ...r,
              storeLabel: labelOf(r.unitId),
              storeColor: storeColor(r.unitId, prefFor(r.unitId).color),
            }))}
            kindUI={KIND_UI}
            onPress={(r) => void openCrossRow(r as unknown as CrossNotifRow)}
            empty={{
              icon: 'notifications-off-outline',
              text: '전체 매장에 새 알림이 없어요.',
              sub: '소속된 모든 매장의 공지·교대 요청을 여기에 모아서 보여드려요.',
            }}
          />
        ) : (
          <NotificationList
            rows={rows}
            kindUI={KIND_UI}
            onPress={(r) => {
              if (r.readFeedId) markNoticeRead(r.readFeedId, me); // 공지·멘션은 탭하면 읽음 처리
              router.push(r.route as Href);
            }}
            empty={{
              icon: 'notifications-off-outline',
              text: '아직 새 알림이 없어요.',
              sub: '공지·교대 요청이 오면 여기에 모아서 보여드려요.',
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

  // 정체성 카드
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
