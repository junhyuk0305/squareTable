import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { NotificationList } from '@/components/NotificationList';
import { todayStr } from '@/lib/utils/attendance';
import { buildJuniorNotifications, type JuniorNotifKind } from '@/lib/utils/notifications';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** kind → 아이콘·틴트 매핑(데이터는 순수 util에서, UI 표현만 여기서). */
const KIND_UI: Record<JuniorNotifKind, { icon: IconName; tint: string }> = {
  notice: { icon: 'megaphone', tint: BrandColors.yellowSoft },
  mention: { icon: 'at', tint: BrandColors.brandSoft },
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
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);
  const swaps = useScheduleStore((s) => s.swaps);
  const templates = useScheduleStore((s) => s.templates);
  const staff = useStaffStore((s) => s.staff);
  const today = todayStr();

  const rows = useMemo(
    () =>
      buildJuniorNotifications({
        feed,
        swaps,
        templates,
        nameOf: (id) => (id === me ? '나' : staff.find((x) => x.id === id)?.name ?? '동료'),
        userId: me,
        today,
      }),
    [feed, swaps, templates, staff, me, today],
  );

  const initial = (userName ?? '나').trim().slice(0, 1) || '나';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{ title: '알림', headerLeft: () => <HeaderBackButton fallback="/junior/home" /> }}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 맨 위 — 매장명 · 내 이름(정체성). 홈 헤더에서 옮겨온 정보 */}
        <View style={styles.idCard}>
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
        </View>

        {/* 알림 목록 — 직원·사장 공유 NotificationList */}
        <NotificationList
          rows={rows}
          kindUI={KIND_UI}
          onPress={(r) => {
            if (r.noticeId) markNoticeRead(r.noticeId, me); // 공지는 탭하면 읽음 처리
            router.push(r.route as Href);
          }}
          empty={{
            icon: 'notifications-off-outline',
            text: '아직 새 알림이 없어요.',
            sub: '공지·교대 요청이 오면 여기에 모아서 보여드려요.',
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
