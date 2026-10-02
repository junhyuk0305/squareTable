import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Wordmark } from '@/components/Wordmark';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, SIDE_NAV_WIDTH } from '@/lib/theme/layout';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * 겸직자(본사 담당자이면서 매장 사장) 전환기 — subtitle 자리를 눌러 여는 드롭다운(웹진입구조 레퍼런스 §4-2).
 * 항목이 없으면 subtitle 은 글자만이고 눌리지 않는다. 별도 착지 선택 화면·하단 항목 쌍은 두지 않는다.
 */
export type NavSwitchOption = { key: string; label: string; icon: IconName; onPress: () => void };

/** 사이드바 한 줄. `onPress` 를 부르는 쪽이 이동을 정한다(탭 루트=replace · 서브화면=push). */
export type NavItem = {
  key: string;
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
};

/** 머리글 하나 + 그 아래 항목들. 머리글이 없으면(하단 고정 묶음) `label` 을 비운다. */
export type NavGroup = { label?: string; items: NavItem[] };

/**
 * 넓은 웹 셸의 왼쪽 사이드바 — 본사 대시보드와 사장 웹이 **같은 컴포넌트**를 쓰고 항목만 다르다.
 * 형태는 `기획/ux/본사대시보드_데모_2026-08-24.html` 의 `.side/.navlabel/.navitem` 을 옮긴 것이고,
 * 색은 앱 토큰(`InkColors`·`BrandColors`)이 정본이다(데모의 --y-deep 는 쓰지 않는다).
 *
 * 표시 전용이다 — 판정(누가 무엇을 보는가·어디가 활성인가)은 부르는 셸이 해서 props 로 넘긴다.
 */
export function SideNav({
  subtitle,
  switchOptions,
  groups,
  footer,
}: {
  /** 워드마크 아래 한 줄 — 사장 웹은 지금 매장, 본사는 브랜드 이름이 온다. */
  subtitle?: ReactNode;
  /** 있으면 subtitle 이 전환기(드롭다운)가 된다 — 겸직자의 본사 ↔ 내 매장. */
  switchOptions?: NavSwitchOption[];
  groups: NavGroup[];
  /** 아래에 붙는 묶음(알림·계정 설정·로그아웃). 사이드바가 짧아도 항상 목록 끝에 온다. */
  footer?: NavGroup;
}) {
  const [open, setOpen] = useState(false);
  const switchable = !!switchOptions && switchOptions.length > 0;
  return (
    <View testID="side-nav" style={styles.side}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <Wordmark size="xs" />
          {subtitle ? (
            switchable ? (
              <View>
                <Pressable
                  testID="nav-switcher"
                  onPress={() => setOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="다른 화면으로 전환"
                  accessibilityState={{ expanded: open }}
                  style={({ pressed }) => [styles.switchBtn, (pressed || open) && { backgroundColor: InkColors.paper }]}
                >
                  <Text numberOfLines={1} style={[styles.sub, { flex: 1 }]}>{subtitle}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color={InkColors.ink3} />
                </Pressable>
                {open ? (
                  <View style={styles.menu} testID="nav-switcher-menu">
                    {switchOptions!.map((o) => (
                      <Pressable
                        key={o.key}
                        testID={`nav-switch-${o.key}`}
                        onPress={() => {
                          setOpen(false);
                          o.onPress();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={o.label}
                        style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: InkColors.paper }]}
                      >
                        <Ionicons name={o.icon} size={16} color={InkColors.ink2} />
                        <Text numberOfLines={1} style={styles.menuText}>{o.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : (
              <Text numberOfLines={1} style={styles.sub}>{subtitle}</Text>
            )
          ) : null}
        </View>

        {groups.map((g, gi) => (
          <View key={g.label ?? `g${gi}`}>
            {gi > 0 ? <View style={styles.divider} /> : null}
            {g.label ? <Text numberOfLines={1} style={styles.navlabel}>{g.label}</Text> : null}
            {g.items.map((it) => (
              <NavRow key={it.key} item={it} />
            ))}
          </View>
        ))}

        {footer ? (
          <View>
            <View style={styles.divider} />
            {footer.items.map((it) => (
              <NavRow key={it.key} item={it} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function NavRow({ item }: { item: NavItem }) {
  const color = item.active ? InkColors.ink : InkColors.ink2;
  return (
    <Pressable
      testID={`nav-${item.key}`}
      onPress={item.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: item.active }}
      accessibilityLabel={item.label}
      style={({ pressed }) => [
        styles.navitem,
        item.active && styles.navitemOn,
        pressed && !item.active && styles.navitemPressed,
      ]}
    >
      {/* 활성 표시는 색 하나로 하지 않는다 — 점 + 배경 + 굵기 셋이 같이 바뀐다(시맨틱 색 규칙). */}
      <View style={[styles.dot, item.active && styles.dotOn]} />
      <Ionicons name={item.icon} size={18} color={color} />
      <Text numberOfLines={1} style={[styles.navtext, { color, fontWeight: item.active ? '800' : '600' }]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  side: {
    width: SIDE_NAV_WIDTH,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  scroll: { paddingVertical: Space.xl, paddingHorizontal: Space.md, paddingBottom: 40 },
  brand: { paddingHorizontal: Space.sm, paddingBottom: Space.lg, gap: Space.xs },
  sub: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 4, borderRadius: Radius.sm },
  menu: { marginTop: 4, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, backgroundColor: InkColors.bg, paddingVertical: 4, ...Elevation.e2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: 10, paddingHorizontal: Space.md, minHeight: 44 },
  menuText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: InkColors.ink },
  navlabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: InkColors.ink3,
    paddingTop: Space.md,
    paddingBottom: Space.xs,
    paddingHorizontal: Space.md,
  },
  navitem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    // 터치 타깃 하한 48dp(화면복잡도 원칙 §4) — 데모 HTML 보다 한 단계 성기다.
    minHeight: 48,
    marginBottom: 2,
  },
  navitemOn: { backgroundColor: InkColors.paper },
  navitemPressed: { backgroundColor: InkColors.bgSoft },
  navtext: { flex: 1, fontSize: 15 },
  dot: { width: 5, height: 5, borderRadius: Radius.pill, backgroundColor: 'transparent' },
  dotOn: { backgroundColor: BrandColors.yellowDeep },
  divider: { height: 1, backgroundColor: InkColors.line, marginVertical: Space.md, marginHorizontal: Space.md },
});
