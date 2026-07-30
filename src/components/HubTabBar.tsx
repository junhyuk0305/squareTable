// 허브(1레이어) 하단 탭바 — 2탭: [현황(사장)/오늘(직원) · 매장]. 기획 v2 확정(2026-07-24).
// ★알림은 탭이 아니다 — 상단 벨 고정(사용자 확정). 매장 앱 RoleTabBar 와 별개 컴포넌트이며
// 매장 앱에 들어가면 이 탭바는 사라진다(2레이어 경계). 탭 이동은 goToTab(replace) 규칙 공유.
import { View, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabButton, goToTab, type Tab } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { assignedTodayCount } from '@/lib/utils/crossStoreNotifs';
import { todayStr } from '@/lib/utils/attendance';
import { InkColors } from '@/lib/theme/colors';

const TABS: Record<'junior' | 'owner', Tab[]> = {
  owner: [
    { label: '현황', path: '/hub', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
    { label: '매장', path: '/stores', icon: 'storefront-outline', iconActive: 'storefront' },
  ],
  junior: [
    { label: '오늘', path: '/hub', icon: 'today-outline', iconActive: 'today' },
    // 3탭 확장(2026-07-30 확정) — 축적·순환 레이어의 독립 홈. 뱃지 없음(재촉 아닌 축적 공간).
    { label: '성장', path: '/hub-growth', icon: 'trending-up-outline', iconActive: 'trending-up' },
    { label: '매장', path: '/stores', icon: 'storefront-outline', iconActive: 'storefront' },
  ],
};

/** 첫 탭 뱃지 — 사장 = 확인 필요(합류 신청+받은질문+검토할 제안, 크로스 알림 원천과 동일 데이터.
 *  검증 필요 노하우는 overview 스코프라 뱃지에서 제외 — 화면 '확인 필요' 블록에는 표시된다).
 *  직원 = 오늘 처리할 배정 할일 합계(assignedTodayCount SSOT). */
function useFirstTabBadge(role: 'junior' | 'owner'): number {
  const me = useSessionStore((s) => s.userId);
  const sessionStores = useSessionStore((s) => s.stores);
  const crossData = useCrossNotifStore((s) => s.data);
  const today = todayStr();
  if (role === 'owner') {
    const ownerUnits = new Set(sessionStores.filter((u) => u.role === 'owner').map((u) => u.unit_id));
    return crossData
      .filter((d) => ownerUnits.has(d.unitId))
      .reduce((n, d) => n + d.pending.length + d.queue.length + d.suggestions.length, 0);
  }
  return crossData.reduce((n, d) => n + assignedTodayCount(d, me, today), 0);
}

export function HubTabBar({ role }: { role: 'junior' | 'owner' }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const badge = useFirstTabBadge(role);
  const tabs = TABS[role];

  const isActive = (t: Tab) => pathname === String(t.path) || pathname.startsWith(`${String(t.path)}/`);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((t, i) => (
        <TabButton
          key={String(t.path)}
          tab={t}
          active={isActive(t)}
          badge={i === 0 ? badge : undefined}
          onPress={() => {
            if (!isActive(t)) goToTab(t.path);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    paddingTop: 8,
  },
});
