import { useEffect, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { SideNav, type NavGroup, type NavSwitchOption } from '@/components/shell/SideNav';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { confirmAction } from '@/lib/utils/confirm';
import { logout } from '@/lib/auth';
import { InkColors } from '@/lib/theme/colors';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * 본사 대시보드 5메뉴 — 이름은 기획정본 §5-2 그대로(일반 SaaS 어휘).
 * 순서도 정본 순서다: 대시보드 · 매장 · 노하우 · 퀴즈 · 설정.
 */
const HQ_NAV: { path: Href; label: string; icon: IconName }[] = [
  { path: '/hq', label: '대시보드', icon: 'grid-outline' },
  { path: '/hq/stores', label: '매장', icon: 'storefront-outline' },
  { path: '/hq/knowhow', label: '노하우', icon: 'bulb-outline' },
  { path: '/hq/quizzes', label: '퀴즈', icon: 'school-outline' },
  { path: '/hq/settings', label: '설정', icon: 'settings-outline' },
];

/**
 * 본사 담당자의 데스크톱 셸 — **웹 전용이고 넓은 레이아웃 전용**이다(기획정본 §5-1).
 * 폰 프레임(460)을 쓰지 않고, 매장 앱 화면을 여기 끼워 넣지 않는다.
 *
 * P1 에서는 뼈대만이다: 사이드바 5메뉴 + 빈 본문. 화면 내용은 P3~P6 에서 채운다.
 */
export function HqShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stores = useSessionStore((s) => s.stores);
  const unitId = useSessionStore((s) => s.unitId);
  const brandName = useBrandStore((s) => s.brand?.brand_name ?? null);
  const hydrateBrand = useBrandStore((s) => s.hydrate);
  // 브랜드 이름은 my_brand 확장 행에서 — 화면들이 같은 캐시를 쓰므로 여기서 한 번 당겨 두면 첫 화면이 빈 표로 깜빡이지 않는다.
  useEffect(() => { void hydrateBrand(); }, [hydrateBrand]);

  const groups: NavGroup[] = [
    {
      items: HQ_NAV.map((n) => {
        const base = String(n.path);
        return {
          key: base,
          label: n.label,
          // '/hq' 는 대시보드라 하위 경로까지 활성으로 보면 전부 켜진다 — 자기 경로만 본다.
          active: base === '/hq' ? pathname === '/hq' : pathname === base || pathname.startsWith(`${base}/`),
          icon: n.icon,
          onPress: () => router.replace(n.path),
        };
      }),
    },
  ];

  // 담당자가 자기 매장도 갖고 있으면(직영 점주 겸직) 전환기 — subtitle(브랜드명) 자리를 눌러 연다(P3, 레퍼런스 §4-2).
  // 하단 항목 쌍('내 매장으로' ↔ '본사 대시보드')은 P3 에서 없앴다 — 전환 수단은 한 곳.
  const switchOptions: NavSwitchOption[] =
    stores.length > 0 || unitId
      ? [{ key: 'my-stores', label: '내 매장으로', icon: 'storefront-outline', onPress: () => router.replace('/stores') }]
      : [];
  const footerItems = [];
  footerItems.push({
    key: 'logout',
    label: '로그아웃',
    icon: 'log-out-outline' as IconName,
    active: false,
    onPress: () => {
      void (async () => {
        if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃', { icon: 'log-out-outline' })) {
          await logout();
        }
      })();
    },
  });

  return (
    <View style={styles.outer}>
      <SideNav subtitle={brandName ?? '본사'} switchOptions={switchOptions} groups={groups} footer={{ items: footerItems }} />
      <View testID="hq-main" style={styles.main}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, flexDirection: 'row', backgroundColor: InkColors.bg },
  // ★폭 캡이 없다 — 본사 화면은 넓은 레이아웃 전용이다(정본 §5-1).
  main: { flex: 1, minWidth: 0, backgroundColor: InkColors.bg },
});
