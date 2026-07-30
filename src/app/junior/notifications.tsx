import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, type Href } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { showToast } from '@/lib/store/useToastStore';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { Appear } from '@/components/Appear';
import { NotificationList, JUNIOR_KIND_UI } from '@/components/NotificationList';
import { NotificationEnableCard } from '@/components/NotificationEnableCard';
import { SegmentTabs } from '@/components/SegmentTabs';
import { todayStr } from '@/lib/utils/attendance';
import { buildJuniorNotifications } from '@/lib/utils/notifications';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

// kind → 아이콘·틴트 매핑은 NotificationList 의 JUNIOR_KIND_UI 공유(허브 통합 알림과 재정의 금지).
const KIND_UI = JUNIOR_KIND_UI;

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
  const storeName = useSessionStore((s) => s.storeName) || '우리 매장';

  const feed = useWorkStore((s) => s.feed);
  const taskTemplates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);
  const markAllRead = useWorkStore((s) => s.markAllRead);
  const swaps = useScheduleStore((s) => s.swaps);
  const templates = useScheduleStore((s) => s.templates);
  const staff = useStaffStore((s) => s.staff);
  // 내 제안 검토 결과(반영/반려+사유) 알림용 — 이 화면 진입 시 당긴다(내공간 밖에선 미로드일 수 있음).
  const suggestions = useSuggestionStore((s) => s.suggestions);
  useEffect(() => { void useSuggestionStore.getState().hydrate(); }, []);
  const today = todayStr();
  // '모두 읽기' 기준 시각(0078) — read 개념이 없는 배정·교대의 배지·강조 해제 축.
  const unitId = useSessionStore((s) => s.unitId);
  const ackNotifs = useMemberPrefsStore((s) => s.ackNotifs);
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));

  // ── 통합 알림(전체 매장, 0077) — 다점포 소속일 때만 세그먼트 노출.
  //    판정·매핑·탭 동작(전환 후 읽음처리 포함)은 공용 훅(useCrossNotifRows) SSOT.
  const sessionStores = useSessionStore((s) => s.stores);
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  const multiStore = sessionStores.length > 1;
  const [seg, setSeg] = useState<'store' | 'all'>('store');
  useEffect(() => {
    if (multiStore) void hydrateCross();
  }, [multiStore, hydrateCross]);
  const { listRows: allRows, totalUnread: allUnread, openRow } = useCrossNotifRows();

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
        ackAt,
        suggestions,
      }),
    [feed, swaps, templates, staff, me, today, taskTemplates, done, ackAt, suggestions],
  );

  const initial = (userName ?? '나').trim().slice(0, 1) || '나';

  // '모두 읽기' = ① 공지·멘션은 read_by 기록(기존 경로) + ② 배정·교대는 ack 시각(0078)으로 강조 해제.
  const unreadReadIds = useMemo(
    () => rows.filter((r) => r.unread && r.readFeedId).map((r) => r.readFeedId as string),
    [rows],
  );
  const hasUnread = useMemo(() => rows.some((r) => r.unread), [rows]);

  function markAll() {
    if (!hasUnread) return;
    if (unreadReadIds.length > 0) markAllRead(unreadReadIds, me);
    if (unitId) void ackNotifs(unitId);
    showToast('모두 읽음 처리했어요', 'good');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '알림',
          headerLeft: () => <HeaderBackButton fallback="/junior/home" />,
          // 전체 읽음은 활성 매장 것만 가능(다른 매장 read_by 는 RLS 스코프 밖) → '이 매장' 탭에서만.
          headerRight: () => (seg === 'store' && hasUnread ? <MarkAllReadButton onPress={markAll} /> : null),
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
            rows={allRows}
            kindUI={KIND_UI}
            onPress={(r) => void openRow(r)}
            // 로드 전엔 "없음"으로 위장하지 않는다(로드 실패는 readFail 배너가 표면화).
            empty={
              crossLoaded
                ? {
                    icon: 'notifications-off-outline',
                    text: '전체 매장에 새 알림이 없어요.',
                    sub: '소속된 모든 매장의 공지·교대 요청을 여기에 모아서 보여드려요.',
                  }
                : { icon: 'notifications-outline', text: '알림을 불러오는 중이에요.' }
            }
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
