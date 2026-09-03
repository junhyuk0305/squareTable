import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * 왼쪽 가장자리 스와이프 → 이전 화면 (Android 전용, 2026-09-03 사용자 요청).
 *
 * - iOS 는 네이티브 스택이 가장자리 스와이프를 기본 제공하므로 손대지 않는다(겹치면 두 번 뒤로 간다).
 * - Android 네이티브 스택(react-native-screens)은 iOS 식 드래그 뒤로가기가 없다 — 시스템 뒤로 제스처(양쪽 가장자리)는
 *   OS 가 처리하지만 3버튼 탐색 기기엔 스와이프가 없어서 앱이 하나 더 준다.
 * - **가장자리에서 시작한 드래그만** 받는다(`hitSlop` 왼쪽 EDGE_WIDTH). 화면 어디서나 받으면 가로 캐러셀·주간 근무표·히어로
 *   스와이프와 경쟁해 스크롤을 뺏는다. iOS 기본값도 가장자리다.
 * - 손가락을 따라 화면이 끌려오는 애니메이션은 없다. 놓는 순간 판정해 일반 뒤로가기 전환을 재생한다.
 * - 판정은 `router.canDismiss()` — **가장 가까운 스택** 안에 이전 화면이 있을 때만. 전역 canGoBack 은 부모 스택까지 봐서
 *   그룹 첫 화면에서 /stores 로 새어 나간 선례(#14, HeaderBackButton 주석)가 있다.
 */
const EDGE_WIDTH = 32; // 시작 허용 폭(dp)
const TRIGGER_DX = 96; // 이만큼 끌어 놓으면
const TRIGGER_VX = 900; // 또는 이 속도로 튕기면

const pan = Gesture.Pan()
  .hitSlop({ left: 0, width: EDGE_WIDTH })
  .activeOffsetX(16) // 가로로 16dp 움직여야 활성 — 가장자리 버튼 탭은 그대로 통과
  .failOffsetY([-12, 12]) // 세로가 먼저면 실패 — 세로 스크롤을 안 뺏는다
  .runOnJS(true)
  .onEnd((e) => {
    if (e.translationX > TRIGGER_DX || e.velocityX > TRIGGER_VX) {
      if (router.canDismiss()) router.dismiss();
    }
  });

export function SwipeBack({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'android') return <GestureHandlerRootView style={styles.fill}>{children}</GestureHandlerRootView>;
  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={pan}>
        <View style={styles.fill} collapsable={false}>
          {children}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = { fill: { flex: 1 } } as const;
