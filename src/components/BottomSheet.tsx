import { Modal, View, Pressable, Animated, PanResponder, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { USE_NATIVE_DRIVER } from '@/lib/anim';
import { KeyboardShift } from '@/components/KeyboardShift';
import { modalFrameStyle } from '@/lib/theme/layout';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

/**
 * 공용 바텀시트 스캐폴드 — 5개 모달(노하우상세·교대요청·할일추가·시프트선택·근무표편집)에 byte-단위로
 * 복붙되던 Modal+프레임컬럼+딤배경+시트+그립 스캐폴드를 통합.
 *
 * ⚠️ 프레임 격리(AGENTS.md): RN <Modal>은 ResponsiveShell 밖(document body)으로 렌더되므로 웹에서
 * 좌우로 새지 않게 modalFrameStyle 컬럼으로 감싸고 그 안에 [backdrop(flex:1)][sheet]를 둔다.
 * 이 한 곳에서 보장 → 모달마다 프레임 처리를 틀릴 위험 제거.
 *
 * ⚠️ 하단 안전영역(2026-09-02 실기기): Android 15 edge-to-edge 는 Modal 창도 네비게이션 바 밑까지
 * 그린다 — 시트 하단 버튼이 제스처바·3버튼 바에 가려졌다. translucent 두 프롭으로 전 버전에서
 * 동일하게 edge-to-edge 로 만들고, 시트 안 마지막에 insets.bottom 스페이서를 둔다(시트별
 * paddingBottom 을 덮지 않는다). iOS 홈 인디케이터도 같은 처리로 해결된다.
 *
 * 시트 높이는 모달마다 달라서(height '80%' / maxHeight '88%' / paddingBottom 등) sheetStyle prop으로 받는다.
 * 그립은 한 값으로 정규화(기존 marginBottom 4/6·radius 99/100 드리프트 통일).
 */
export function BottomSheet({
  visible,
  onClose,
  sheetStyle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** 모달별 시트 높이/패딩 등 (예: { height: '80%' } 또는 { maxHeight: '88%' }). */
  sheetStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // 아래로 끌어 내리기(2026-09-03): 시트가 손가락을 따라 내려가고, 놓을 때 충분히 내렸으면 닫힌다.
  // ★비캡처 응답자라 시트 안 ScrollView 가 먼저 잡는다 — 스크롤되는 시트에서는 스크롤이 이긴다.
  //   위로는 안 끌린다(0 하한). 닫힘 애니는 Modal 의 slide 가 맡으므로 여기선 위치만 되돌린다.
  const dragY = useMemo(() => new Animated.Value(0), []);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DISMISS_DY || g.vy > DISMISS_VY) {
            dragY.setValue(0);
            onClose();
            return;
          }
          Animated.spring(dragY, { toValue: 0, useNativeDriver: USE_NATIVE_DRIVER, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => dragY.setValue(0),
      }),
    [dragY, onClose],
  );
  // 다시 열릴 때 지난 드래그 위치가 남지 않게.
  useEffect(() => { if (visible) dragY.setValue(0); }, [visible, dragY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* ★키보드(2026-09-03 실기기): Modal 은 별도 창이라 화면의 KeyboardShift 가 여기까지 못 미치고,
          translucent 창은 adjustResize 도 안 받는다 — 시트 안 입력(할일 추가·교대 요청·파트 이름…)이 키보드에
          그대로 덮였다. 프레임 컬럼 자체를 KeyboardShift 로 세워 시트가 키보드 위로 올라오게 한다. */}
      <KeyboardShift style={modalFrameStyle}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
        <Animated.View style={[styles.sheet, sheetStyle, { transform: [{ translateY: dragY }] }]} {...pan.panHandlers}>
          <View style={styles.grip} />
          {children}
          {insets.bottom > 0 && <View style={{ height: insets.bottom }} />}
        </Animated.View>
      </KeyboardShift>
    </Modal>
  );
}

/** 놓았을 때 닫히는 기준 — 끌어 내린 거리(px) 또는 속도(px/ms). */
const DISMISS_DY = 80;
const DISMISS_VY = 0.6;

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: InkColors.bg,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    ...Elevation.e3,
  },
  grip: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.line,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
});
