import { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { InkColors } from '@/lib/theme/colors';
import { USE_NATIVE_DRIVER } from '@/lib/anim';

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = { label: string; path: Href; icon: IconName; iconActive: IconName };

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
    { label: '업무', path: '/junior/work', icon: 'briefcase-outline', iconActive: 'briefcase' },
    { label: '출퇴근', path: '/junior/attendance', icon: 'time-outline', iconActive: 'time' },
    { label: '설정', path: '/junior/settings', icon: 'settings-outline', iconActive: 'settings' },
  ],
  owner: [
    { label: '홈', path: '/owner/dashboard', icon: 'home-outline', iconActive: 'home' },
    { label: '노하우', path: '/owner/categories', icon: 'bulb-outline', iconActive: 'bulb' },
    { label: '받은질문', path: '/owner/inbox', icon: 'file-tray-outline', iconActive: 'file-tray' },
    { label: '업무', path: '/owner/work', icon: 'briefcase-outline', iconActive: 'briefcase' },
    { label: '설정', path: '/owner/settings', icon: 'settings-outline', iconActive: 'settings' },
  ],
};

/** 역할별 하단 탭바 (아이콘 + 라벨). 메인 화면 하단에 배치. */
export function RoleTabBar({ role }: { role: 'junior' | 'owner' }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const tabs = TABS[role];

  // pathname은 쿼리/해시가 제거된 문자열. t.path는 Href(미래에 쿼리·세그먼트가 붙을 수 있음)이므로
  // 정확 일치 + 하위 경로(`/base/...`)까지 활성으로 본다 → 경로가 바뀌어도 하이라이트가 깨지지 않는다.
  const isActive = (path: Href) => {
    const base = String(path);
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((t) => (
        <TabButton
          key={String(t.path)}
          tab={t}
          active={isActive(t.path)}
          onPress={() => {
            if (!isActive(t.path)) router.replace(t.path);
          }}
        />
      ))}
    </View>
  );
}

/** 개별 탭 — 누르면 살짝 줄고, 활성화되는 순간 아이콘이 톡 튀어오른다. */
function TabButton({ tab, active, onPress }: { tab: Tab; active: boolean; onPress: () => void }) {
  const color = active ? InkColors.ink : InkColors.ink3;
  const press = useRef(new Animated.Value(1)).current; // 눌림 스케일
  const pop = useRef(new Animated.Value(1)).current; // 활성화 순간 팝(0.8→1)

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
    minHeight: 44,
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
  },
});
