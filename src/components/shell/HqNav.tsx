// HqNav.tsx — 본사 셸의 2단 메뉴(표시 전용): 왼쪽 어두운 아이콘 줄(큰 메뉴) + 흰 하위 메뉴 칸(제목 · 항목 · 트리).
//
// 왜 2단인가(2026-10-02 사용자 요청 · 레퍼런스 개편): 한 화면에 기능을 하나씩 두려면 '매장' 아래에
// 전체 매장 · 초대 대기 · 매장 이름 목록이 따로 서야 한다. 1단 사이드바(SideNav)는 항목 5개뿐이라
// 그 하위를 한 화면에 몰아 넣고 있었다.
// ★사장 웹 셸은 그대로 `SideNav` 를 쓴다 — 이 파일은 본사 전용이다.
// ★판정(어디가 활성인가·무엇을 보이나)은 부르는 셸(HqShell)이 해서 props 로 넘긴다.
// ★활성 표시는 aria-selected 로도 준다 — RN-web 은 accessibilityState.selected 를 DOM 에 그리지 않아서(2026-10-02 실측)
//   화면 낭독기가 지금 어느 메뉴인지 몰랐다. accessibilityState 는 네이티브 몫으로 둔다.
import { type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, HQ_RAIL_WIDTH, HQ_SUBNAV_WIDTH } from '@/lib/theme/layout';

type IconName = keyof typeof Ionicons.glyphMap;

export type RailItem = { key: string; label: string; icon: IconName; active: boolean; onPress: () => void };

// 어두운 줄 위 글자·면 — 앱 토큰에 어두운 면용 값이 없어 여기서만 쓴다(흰 글자 투명도 단계).
const ON_DARK = 'rgba(255,255,255,0.62)';
const ON_DARK_ACTIVE_BG = 'rgba(255,255,255,0.14)';

/** 아이콘 줄 — 큰 메뉴 5개 + 아래 고정 묶음(내 매장으로 · 로그아웃). 맨 위는 브랜드 첫 글자(누르면 대시보드). */
export function HqRail({
  brandName,
  onBrandPress,
  items,
  footer,
}: {
  brandName: string;
  onBrandPress: () => void;
  items: RailItem[];
  footer: RailItem[];
}) {
  return (
    <View style={styles.rail} testID="side-nav">
      <Pressable
        onPress={onBrandPress}
        accessibilityRole="button"
        accessibilityLabel={`${brandName} 대시보드`}
        style={({ pressed }) => [styles.mark, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.markText}>{brandName.trim().slice(0, 1) || '본'}</Text>
      </Pressable>
      <View style={styles.railItems}>
        {items.map((it) => <RailRow key={it.key} item={it} />)}
      </View>
      <View style={styles.railFoot}>
        {footer.map((it) => <RailRow key={it.key} item={it} />)}
      </View>
    </View>
  );
}

function RailRow({ item }: { item: RailItem }) {
  return (
    <Pressable
      testID={`nav-${item.key}`}
      onPress={item.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: item.active }}
      aria-selected={item.active}
      accessibilityLabel={item.label}
      style={({ pressed }) => [styles.railItem, item.active && styles.railItemOn, pressed && !item.active && { opacity: 0.75 }]}
    >
      <Ionicons name={item.icon} size={20} color={item.active ? InkColors.bubbleText : ON_DARK} />
      <Text numberOfLines={1} style={[styles.railText, item.active && styles.railTextOn]}>{item.label}</Text>
    </Pressable>
  );
}

export type SubItem = { key: string; label: string; count?: number; active: boolean; onPress: () => void };

/** 하위 메뉴 칸 — 제목(+ 만들기 버튼) · 항목 · 그 아래 트리(children, 예: 매장 이름 목록). */
export function HqSubNav({
  title,
  add,
  items,
  children,
}: {
  title: string;
  /** 제목 오른쪽 + — 이 메뉴에서 새로 만드는 것(매장 추가 · 노하우 쓰기 · 퀴즈 만들기). */
  add?: { label: string; onPress: () => void; testID?: string };
  items: SubItem[];
  children?: ReactNode;
}) {
  return (
    <View style={styles.sub} testID="hq-subnav">
      <ScrollView contentContainerStyle={styles.subScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.subHead}>
          <Text numberOfLines={1} style={styles.subTitle}>{title}</Text>
          {add ? (
            <Pressable
              onPress={add.onPress}
              accessibilityRole="button"
              accessibilityLabel={add.label}
              testID={add.testID}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="add" size={18} color={InkColors.bubbleText} />
            </Pressable>
          ) : null}
        </View>
        {items.map((it) => (
          <Pressable
            key={it.key}
            testID={`subnav-${it.key}`}
            onPress={it.onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: it.active }}
            aria-selected={it.active}
            accessibilityLabel={it.label}
            style={({ pressed }) => [styles.subItem, it.active && styles.subItemOn, pressed && !it.active && { backgroundColor: InkColors.bgSoft }]}
          >
            <Text numberOfLines={1} style={[styles.subText, it.active && styles.subTextOn]}>{it.label}</Text>
            {it.count !== undefined ? <Text style={styles.subCount}>{it.count}</Text> : null}
          </Pressable>
        ))}
        {children ? <View style={styles.subTree}>{children}</View> : null}
      </ScrollView>
    </View>
  );
}

/** 트리 한 줄(하위 메뉴 아래 목록) — 점 + 이름. 길면 말줄임. */
export function SubLeaf({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.leaf, active && styles.subItemOn, pressed && !active && { backgroundColor: InkColors.bgSoft }]}
    >
      <View style={[styles.leafDot, active && { backgroundColor: InkColors.ink }]} />
      <Text numberOfLines={1} style={[styles.leafText, active && styles.subTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { width: HQ_RAIL_WIDTH, flexShrink: 0, backgroundColor: InkColors.ink, alignItems: 'center', paddingTop: Space.lg, paddingBottom: Space.md },
  mark: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: BrandColors.yellow, alignItems: 'center', justifyContent: 'center', marginBottom: Space.lg },
  markText: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  railItems: { gap: Space.xs, alignItems: 'center' },
  railFoot: { marginTop: 'auto', gap: Space.xs, alignItems: 'center' },
  railItem: { width: HQ_RAIL_WIDTH - Space.md, minHeight: 56, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: Space.sm },
  railItemOn: { backgroundColor: ON_DARK_ACTIVE_BG },
  railText: { fontSize: 11.5, fontWeight: '700', color: ON_DARK },
  railTextOn: { color: InkColors.bubbleText },

  sub: { width: HQ_SUBNAV_WIDTH, flexShrink: 0, backgroundColor: InkColors.bg, borderRightWidth: 1, borderRightColor: InkColors.line },
  subScroll: { paddingTop: 22, paddingHorizontal: Space.md, paddingBottom: Space.xl },
  subHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.sm, marginBottom: Space.md, minHeight: 32 },
  subTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },
  addBtn: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  subItem: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 44, paddingHorizontal: Space.md, borderRadius: Radius.sm, marginBottom: 2 },
  subItemOn: { backgroundColor: InkColors.paper },
  subText: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink2 },
  subTextOn: { color: InkColors.ink, fontWeight: '800' },
  subCount: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink3, fontVariant: ['tabular-nums'] },
  subTree: { marginTop: Space.md, paddingTop: Space.lg, borderTopWidth: 1, borderTopColor: InkColors.line },
  leaf: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: Space.md, borderRadius: Radius.sm, marginBottom: 2 },
  leafDot: { width: 6, height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.ink3 },
  leafText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: InkColors.ink2 },
});
