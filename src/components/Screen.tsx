import { type ComponentProps, type ReactNode, type Ref } from 'react';
import { View, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RoleTabBar } from '@/components/RoleTabBar';
import { SectionLabel } from '@/components/SectionLabel';
import { Surface } from '@/lib/theme/colors';
import { Layout, Space, screenScrollStyle } from '@/lib/theme/layout';

/**
 * 화면 틀 — 바탕·첫 여백·좌우 여백·섹션 간격·탭바 자리를 이 부품 하나가 든다(2026-11-02).
 * 화면은 숫자를 적지 않고 조립만 한다. 값은 `Surface.screen`·`Layout` 에 있다.
 *
 * ★위 안전 영역은 **헤더가 소유한다**(ScreenTitleHeader·AppTopBar 가 insets.top 을 든다). 그래서 edges 는 비운다.
 * scroll={false}: 자기 스크롤을 가진 화면(목록·채팅·업무 보드). 바탕만 깔고 여백은 그 화면이 정한다.
 */
export function Screen({
  header,
  tabBar,
  scroll = true,
  scrollRef,
  children,
}: {
  header?: ReactNode;
  tabBar?: 'owner' | 'junior';
  scroll?: boolean;
  scrollRef?: Ref<ScrollView>;
  children: ReactNode;
}) {
  return (
    <SafeAreaView edges={[]} style={styles.safe}>
      {header}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
      {tabBar ? <RoleTabBar role={tabBar} /> : null}
    </SafeAreaView>
  );
}

/** 섹션 쌓기 — 섹션 사이 `Layout.sectionGap`. Screen 의 스크롤 안은 이미 이 간격이다. 이름이 Stack 이 아닌 건 expo-router 의 Stack.Screen 과 부딪혀서다. */
export function SectionStack({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.stack, style]}>{children}</View>;
}

/**
 * 섹션 — 카드 밖 제목(SectionLabel) + 내용. 제목 ↔ 내용은 한 덩어리라 섹션 간격보다 좁게 붙인다.
 * 섹션 사이는 Screen·SectionStack 이 정한다.
 */
export function Section({ children, ...label }: ComponentProps<typeof SectionLabel> & { children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionLabel {...label} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Surface.screen },
  fill: { flex: 1 },
  scroll: screenScrollStyle,
  stack: { gap: Layout.sectionGap },
  // SectionLabel 아래 2 + 여기 8 = 제목 ↔ 카드 10(2026-10-14 사용자 결정 그대로).
  section: { gap: Space.sm },
});
