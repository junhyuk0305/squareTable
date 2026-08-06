import { useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { router as globalRouter, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

type IconName = keyof typeof Ionicons.glyphMap;
export type Tab = { label: string; path: Href; icon: IconName; iconActive: IconName; alsoActiveFor?: Href[] };

/**
 * 각 탭 의미에 맞춘 아이콘. 선택된 탭은 채워진(filled) 아이콘, 나머지는 outline.
 *  - 홈=집, 노하우=전구, 받은질문=수신함, 업무=서류가방, 출퇴근=시계, 설정=톱니
 *
 * 역할별 비대칭 5탭: 공통 spine(홈·노하우·업무·설정) + 역할 본업 1탭.
 *  - 시니어: 가운데 '받은질문'(음성 1터치 답변 = 지식 자산화 플라이휠)
 *  - 주니어: 4번째 '출퇴근'(현장 실행). 질문하기는 노하우 탭 안 세그먼트로.
 * 맨 오른쪽은 두 역할 모두 '설정'(내 정보 관리)으로 고정한다.
 */
const TABS: Record<'junior' | 'owner', Tab[]> = {
  junior: [
    { label: '홈', path: '/junior/home', icon: 'home-outline', iconActive: 'home' },
    // 알바의 본업은 '묻기' — 이 탭은 KnowhowSegment(둘러보기+물어보기, 기본=물어보기)로 연결된다.
    // 사장 '노하우' 탭은 자산 관리라 명사 유지(역할 비대칭은 의도된 설계).
    { label: '물어보기', path: '/junior/chat', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
    { label: '업무 채팅', path: '/junior/work', icon: 'briefcase-outline', iconActive: 'briefcase' },
    // 근무표·내 출퇴근 내역은 '출퇴근' 탭 계열의 서브화면 — 이 경로들에서도 탭을 활성으로 본다.
    { label: '출퇴근', path: '/junior/attendance', icon: 'time-outline', iconActive: 'time', alsoActiveFor: ['/junior/schedule', '/junior/timesheet'] },
    { label: '설정', path: '/junior/settings', icon: 'settings-outline', iconActive: 'settings' },
  ],
  owner: [
    { label: '홈', path: '/owner/dashboard', icon: 'home-outline', iconActive: 'home' },
    { label: '노하우', path: '/owner/categories', icon: 'bulb-outline', iconActive: 'bulb' },
    { label: '받은질문', path: '/owner/inbox', icon: 'file-tray-outline', iconActive: 'file-tray' },
    { label: '업무 채팅', path: '/owner/work', icon: 'briefcase-outline', iconActive: 'briefcase' },
    { label: '설정', path: '/owner/settings', icon: 'settings-outline', iconActive: 'settings' },
  ],
};

/**
 * 탭 루트로 이동 — 탭은 '전환'이지 스택 히스토리가 아니다.
 * push 로 탭 루트를 열면 같은 탭이 스택에 중복 적재돼 ① 뒤로가기 화살표가 새고 ② 전환 애니메이션이
 * 어긋나 하단 탭 활성화가 튀는 현상이 생긴다. 그래서 탭바든 화면 안 바로가기든 탭 이동은 모두
 * 이 함수 하나(replace)로 통일한다(SSOT). 서브화면(뒤로가기 필요) 이동은 여전히 router.push 를 쓴다.
 */
export function goToTab(path: Href) {
  globalRouter.replace(path);
}

/** 역할별 하단 탭바 (아이콘 + 라벨). 메인 화면 하단에 배치. */
export function RoleTabBar({ role }: { role: 'junior' | 'owner' }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const tabs = TABS[role];

  // pathname은 쿼리/해시가 제거된 문자열. t.path는 Href(미래에 쿼리·세그먼트가 붙을 수 있음)이므로
  // 정확 일치 + 하위 경로(`/base/...`)까지 활성으로 본다 → 경로가 바뀌어도 하이라이트가 깨지지 않는다.
  const matchPath = (path: Href) => {
    const base = String(path);
    return pathname === base || pathname.startsWith(`${base}/`);
  };
  // 탭 자기 경로 + 계열 서브화면(alsoActiveFor) 중 하나라도 맞으면 활성.
  const isActive = (t: Tab) => matchPath(t.path) || (t.alsoActiveFor?.some(matchPath) ?? false);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((t) => (
        <TabButton
          key={String(t.path)}
          tab={t}
          active={isActive(t)}
          onPress={() => {
            if (!isActive(t)) goToTab(t.path);
          }}
        />
      ))}
    </View>
  );
}

/** 개별 탭 — 누르면 살짝 줄고, 활성화되는 순간 아이콘이 톡 튀어오른다.
 *  badge: 허브 탭바(HubTabBar)가 쓰는 카운트 뱃지(벨 뱃지와 동일 스타일). RoleTabBar 는 미사용. */
export function TabButton({ tab, active, onPress, badge }: { tab: Tab; active: boolean; onPress: () => void; badge?: number }) {
  const color = active ? InkColors.ink : InkColors.ink3;
  const press = useMemo(() => new Animated.Value(1), []); // 눌림 스케일
  const pop = useMemo(() => new Animated.Value(1), []); // 활성화 순간 팝(0.8→1)

  useEffect(() => {
    if (!active) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, useNativeDriver: USE_NATIVE_DRIVER, speed: 18, bounciness: 16 }).start();
  }, [active, pop]);

  const iconScale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
  const animatePress = (to: number) =>
    Animated.spring(press, { toValue: to, useNativeDriver: USE_NATIVE_DRIVER, speed: 50, bounciness: 8 }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animatePress(0.9)}
      onPressOut={() => animatePress(1)}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <Animated.View style={{ transform: [{ scale: Animated.multiply(press, iconScale) }] }}>
        <Ionicons name={active ? tab.iconActive : tab.icon} size={23} color={color} />
        {(badge ?? 0) > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge! > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </Animated.View>
      <Text numberOfLines={1} style={[styles.label, { color, fontWeight: active ? '800' : '600' }]}>{tab.label}</Text>
    </Pressable>
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
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    // 터치 타깃 하한 48dp (화면복잡도 원칙 §4) — 40대 사용자 + 매장 환경 기준.
    minHeight: 48,
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
  },
  // 벨 뱃지(NotificationBell)와 동일 문법 — 아이콘 우상단 카운트.
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
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
