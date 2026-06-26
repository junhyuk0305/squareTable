import { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { InkColors } from '@/lib/theme/colors';

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = { label: string; path: Href; icon: IconName; iconActive: IconName };

/**
 * 각 탭 의미에 맞춘 아이콘. 선택된 탭은 채워진(filled) 아이콘, 나머지는 outline.
 *  - 챗봇=대화, 출퇴근=시계, 업무=체크리스트, 홈=집, 노하우=전구, 근무·급여=지갑, 설정=톱니
 *
 * 두 역할 모두 항상 4개 탭으로 통일하고, 맨 오른쪽은 '설정'(내 정보 관리)으로 고정한다.
 */
const TABS: Record<'junior' | 'owner', Tab[]> = {
  junior: [
    { label: '홈', path: '/junior/home', icon: 'home-outline', iconActive: 'home' },
    { label: '노하우', path: '/junior/chat', icon: 'bulb-outline', iconActive: 'bulb' },
    { label: '업무', path: '/junior/work', icon: 'checkbox-outline', iconActive: 'checkbox' },
    { label: '설정', path: '/junior/settings', icon: 'settings-outline', iconActive: 'settings' },
  ],
  owner: [
    { label: '홈', path: '/owner/dashboard', icon: 'home-outline', iconActive: 'home' },
    { label: '노하우', path: '/owner/categories', icon: 'bulb-outline', iconActive: 'bulb' },
    { label: '업무', path: '/owner/work', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
    { label: '설정', path: '/owner/settings', icon: 'settings-outline', iconActive: 'settings' },
  ],
};

/** 역할별 하단 탭바 (아이콘 + 라벨). 메인 화면 하단에 배치. */
export function RoleTabBar({ role }: { role: 'junior' | 'owner' }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const tabs = TABS[role];

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((t) => (
        <TabButton
          key={String(t.path)}
          tab={t}
          active={pathname === t.path}
          onPress={() => {
            if (pathname !== t.path) router.replace(t.path);
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
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 16 }).start();
  }, [active, pop]);

  const iconScale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
  const animatePress = (to: number) =>
    Animated.spring(press, { toValue: to, useNativeDriver: true, speed: 50, bounciness: 8 }).start();

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
      <Text style={[styles.label, { color, fontWeight: active ? '800' : '600' }]}>{tab.label}</Text>
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
