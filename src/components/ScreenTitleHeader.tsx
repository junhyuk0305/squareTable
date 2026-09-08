import { type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useNavigation, type Href } from 'expo-router';

import { canManage } from '@/lib/utils/roles';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStoreDisplay } from '@/components/StoreHeaderTitle';
import { InkColors } from '@/lib/theme/colors';
import { SCREEN_GUTTER, Space } from '@/lib/theme/layout';

/**
 * 제목 상단바 — **네이티브 헤더를 끄고 화면 안에서 직접 그린다.**
 *
 * ★왜 네이티브 헤더를 안 쓰나 (2026-09-07 iOS 실기기에서 두 번 막힌 뒤 확정)
 *   ① iOS 네이티브 내비바는 **타이틀 슬롯을 항상 가운데** 둔다. `headerTitleAlign` 은 native-stack 의
 *      안드로이드 전용 옵션이라 iOS 에서 조용히 무시된다("Not supported on iOS. It's always center").
 *   ② 그렇다고 제목을 `headerLeft`(왼쪽 슬롯)로 옮기면, **iOS 26 은 헤더 좌/우 슬롯의 항목을 '바 버튼'으로
 *      취급해 유리 캡슐 배경을 씌운다.** 제목이 버튼처럼 보인다(뒤로가기 화살표에 흰 알약이 붙는 것과 같은 이유).
 *   → 즉 **왼쪽 정렬 평문 제목은 네이티브 헤더로는 낼 수 없다.** 웹과 같은 모습을 원하면 직접 그려야 한다.
 *   같은 판단을 이미 홈이 하고 있다(`AppTopBar` 주석 "네이티브 헤더를 버린 이유").
 *
 * ★상단 인셋은 **이 컴포넌트가 소유한다**(insets.top). 호출부의 SafeAreaView 에 top 을 또 주면 이중이다 —
 *   대상 화면들은 전부 edges 에 top 이 없는 상태이므로 그대로 두면 된다.
 *
 * 쓰는 법: 화면에서 `<Stack.Screen options={{ headerShown: false }} />` 와 함께 최상단에 놓는다.
 */
export function ScreenTitleHeader({
  title,
  storeLine = false,
  onBack,
  backFallback,
  right,
}: {
  title: string;
  /** 제목 아래 "어느 매장인가"(색점+매장명)를 함께 보인다 — 탭 루트용(StoreHeaderTitle 과 같은 규칙). */
  storeLine?: boolean;
  /** 뒤로가기 동작을 직접 정할 때. 보통은 `backFallback` 만 주면 된다. */
  onBack?: () => void;
  /**
   * 뒤로가기 화살표를 붙이고, 뒤로 갈 곳이 없을 때(웹 새로고침·딥링크·푸시 진입) 갈 자리를 정한다.
   * `true` 면 역할별 홈으로. 판정은 `HeaderBackButton` 과 **같은 규칙**이다 — 가장 가까운 네비게이터
   * 기준으로만 canGoBack 을 본다(전역 router 로 보면 그룹 첫 화면에서 상위 라우트로 새어 나간다).
   */
  backFallback?: Href | true;
  /** 오른쪽 끝 액션. */
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const role = useSessionStore((s) => s.role);
  const status = useSessionStore((s) => s.status);
  const signupRole = useSessionStore((s) => s.signupRole);
  const unitId = useSessionStore((s) => s.unitId);
  const goBack = () => {
    if (navigation.canGoBack()) return navigation.goBack();
    // 매장을 아직 안 만든 사장은 profiles.role 이 junior 라 canManage 로는 직원과 구별되지 않는다
    // (role 분리 2026-08-12). 이 사람의 홈은 '매장 만들기'다 — 직원 홈으로 보내면 남의 화면에 떨어진다.
    const ownerBeforeStore = status === 'signed_in' && !unitId && signupRole === 'owner';
    const home: Href =
      backFallback && backFallback !== true
        ? backFallback
        : status !== 'signed_in'
          ? '/'
          : ownerBeforeStore
            ? '/owner/create-store'
            : canManage(role)
              ? '/owner/dashboard'
              : '/junior/home';
    router.replace(home);
  };
  const back = onBack ?? (backFallback ? goBack : undefined);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + Space.sm }]}>
      {back && (
        <Pressable
          onPress={back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
        </Pressable>
      )}
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {storeLine && <StoreLine />}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

/** 매장 표시는 StoreHeaderTitle 과 **같은 판정**을 쓴다(useStoreDisplay) — 두 곳에 복제하지 않는다. */
function StoreLine() {
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const { nameOf, dotColorOf } = useStoreDisplay();
  if (!unitId) return null;
  return (
    <View style={styles.storeLine}>
      <View style={[styles.dot, { backgroundColor: dotColorOf(unitId) }]} />
      {/* 확정 전에는 자리(줄 높이)만 잡는다 — 원본명이라는 중간 단계를 거치지 않게. */}
      <Text style={styles.storeName} numberOfLines={1}>
        {nameOf(unitId, storeName) ?? ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: Space.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  // 화살표는 거터 안쪽에서 시작한다 — 아이콘 좌우 여백만큼 당겨 제목과 같은 리듬을 만든다.
  back: { marginLeft: -4, paddingRight: 6, paddingVertical: 2 },
  titleWrap: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  storeLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  storeName: { fontSize: 11.5, fontWeight: '600', color: InkColors.ink3, maxWidth: 220 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});
