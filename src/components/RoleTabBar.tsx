import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { InkColors } from '@/lib/theme/colors';

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = { label: string; path: Href; icon: IconName; iconActive: IconName };

/**
 * 각 탭 의미에 맞춘 아이콘. 선택된 탭은 채워진(filled) 아이콘, 나머지는 outline.
 *  - 챗봇=대화, 출퇴근=시계, 업무=체크리스트, 홈=집, 노하우=전구, 근무·급여=지갑
 */
const TABS: Record<'junior' | 'owner', Tab[]> = {
  junior: [
    { label: '챗봇', path: '/junior/chat', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
    { label: '출퇴근', path: '/junior/attendance', icon: 'time-outline', iconActive: 'time' },
    { label: '업무', path: '/junior/work', icon: 'checkbox-outline', iconActive: 'checkbox' },
  ],
  owner: [
    { label: '홈', path: '/owner/dashboard', icon: 'home-outline', iconActive: 'home' },
    { label: '노하우', path: '/owner/categories', icon: 'bulb-outline', iconActive: 'bulb' },
    { label: '근무', path: '/owner/attendance', icon: 'wallet-outline', iconActive: 'wallet' },
    { label: '업무', path: '/owner/work', icon: 'checkbox-outline', iconActive: 'checkbox' },
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
      {tabs.map((t) => {
        const active = pathname === t.path;
        const color = active ? InkColors.ink : InkColors.ink3;
        return (
          <Pressable
            key={String(t.path)}
            onPress={() => {
              if (!active) router.replace(t.path);
            }}
            style={styles.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
          >
            <Ionicons name={active ? t.iconActive : t.icon} size={23} color={color} />
            <Text style={[styles.label, { color, fontWeight: active ? '800' : '600' }]}>{t.label}</Text>
          </Pressable>
        );
      })}
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
