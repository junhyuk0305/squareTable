import { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import { SideNav, type NavGroup } from '@/components/shell/SideNav';
import { HUB_TABS } from '@/components/HubTabBar';
import { goToTab, isTabActive, storeTabsFor } from '@/components/RoleTabBar';
import { useStoreDisplay } from '@/components/StoreHeaderTitle';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { confirmAction } from '@/lib/utils/confirm';
import { logout } from '@/lib/auth';
import { InkColors } from '@/lib/theme/colors';
import { OWNER_WEB_MAX_WIDTH } from '@/lib/theme/layout';

/**
 * 사장·매니저의 넓은 웹 셸 — **껍데기만 바꾼다.** 화면 내용·기능은 폰과 한 줄도 다르지 않다.
 *
 * 왼쪽 사이드바가 하단 탭바를 대신하고(탭바는 `useShell()` 로 스스로 빠진다), 본문은
 * `OWNER_WEB_MAX_WIDTH`(720) 캡 + 중앙 정렬이다. 화면들이 460 전제라 그대로 늘리면 깨지므로
 * 한 단계만 넓힌다 — 화면별 두 단 배치는 별도 단계(구현계획 P7).
 *
 * 매장 전환은 **화면 상단바(`StoreToggle`)가 계속 맡는다.** 사이드바에 전환기를 또 두면
 * 한 화면에 같은 전환기가 둘이 된다(2026-09-22 사용자 결정) — 여기는 지금 매장을 **표시만** 한다.
 */
export function OwnerWebShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const role = useSessionStore((s) => s.role);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const { nameOf } = useStoreDisplay();

  // 허브 층은 '사장이냐 아니냐'로만 갈린다(hub.tsx 와 같은 판정) — 매니저는 직원 세트를 본다.
  const hubTabs = HUB_TABS[role === 'owner' ? 'owner' : 'junior'];
  // 매장 층 세트는 하단 탭바와 같은 판정을 쓴다(RoleTabBar.storeTabsFor).
  const storeTabs = storeTabsFor('owner', role);
  // 표시용 이름은 확정 전 null — 원본명을 먼저 적으면 '내 매장 → 신촌점'으로 라벨이 두 번 바뀐다.
  const storeLabel = unitId ? nameOf(unitId, storeName) : null;

  const groups: NavGroup[] = [
    {
      label: '내 계정',
      items: hubTabs.map((t) => ({
        key: String(t.path),
        label: t.label,
        icon: t.icon,
        active: isTabActive(t, pathname),
        onPress: () => goToTab(t.path),
      })),
    },
  ];
  // 활성 매장이 없으면(매장 만들기 전·프로필 완성 전) 매장 묶음을 그리지 않는다 —
  // 머리글이 곧 매장 이름이라 이름 없는 묶음을 만들 수 없다. 항목도 전부 못 가는 곳이다.
  if (unitId) {
    groups.push({
      label: storeLabel ?? '',
      items: storeTabs.map((t) => ({
        key: String(t.path),
        label: t.label,
        icon: t.icon,
        active: isTabActive(t, pathname),
        onPress: () => goToTab(t.path),
      })),
    });
  }

  const footer: NavGroup = {
    items: [
      {
        key: '/notifications',
        label: '알림',
        icon: 'notifications-outline',
        active: pathname === '/notifications',
        onPress: () => router.push('/notifications'),
      },
      {
        key: '/account-settings',
        label: '계정 설정',
        icon: 'person-circle-outline',
        active: pathname === '/account-settings',
        onPress: () => router.push('/account-settings'),
      },
      {
        key: 'logout',
        label: '로그아웃',
        icon: 'log-out-outline',
        active: false,
        // 확인 모달 + 로그아웃은 설정 헤더 버튼과 같은 경로다(HeaderLogoutButton) — 다시 만들지 않는다.
        onPress: () => {
          void (async () => {
            if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃', { icon: 'log-out-outline' })) {
              await logout();
            }
          })();
        },
      },
    ],
  };

  return (
    <View style={styles.outer}>
      <SideNav subtitle={storeLabel ? `지금 · ${storeLabel}` : undefined} groups={groups} footer={footer} />
      <View style={styles.main}>
        {/* 본문 컬럼 — 모달·바텀시트는 ResponsiveShell 때와 같이 바깥(body)으로 나가 frameCapStyle(460)로 가운데에 뜬다. */}
        <View testID="owner-web-content" style={styles.content}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, flexDirection: 'row', backgroundColor: InkColors.bg },
  main: { flex: 1, minWidth: 0, alignItems: 'center', backgroundColor: '#E9E7E0' },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: OWNER_WEB_MAX_WIDTH,
    backgroundColor: InkColors.cream,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#E8E6DF',
  },
});
