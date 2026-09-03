import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, LayoutAnimation, Platform, View, type KeyboardEvent, type StyleProp, type ViewStyle } from 'react-native';
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

/**
 * 키보드 회피 — 화면·시트의 키보드 회피는 전부 이걸로(RN KeyboardAvoidingView 직접 사용 금지. native-audit 규칙 kav-shared).
 *
 * 원리: 키보드가 뜨는 순간, 이 상자의 **창 기준 바닥**과 키보드 윗변(endCoordinates.screenY)이 겹치는 만큼만 paddingBottom 을 준다.
 * 안 겹치면 0 — 창이 리사이즈되는 기기·플랫폼에선 이중 적용이 없다.
 *
 * ★상자의 창 기준 위치는 `measureInWindow` 로 재지 않는다(2026-09-03 실기기 3·4회차 실패의 원인).
 *   새 아키텍처의 measureInWindow 는 네이티브 뷰가 아니라 **JS 레이아웃 트리(shadow tree)** 의 좌표를 돌려준다.
 *   네이티브 헤더(react-native-screens)가 있는 화면은 그 트리의 원점이 헤더 높이를 **추정치**로만 반영해 실제 창과 어긋나고,
 *   그만큼 입력창이 키보드에 가려졌다. 업무 채팅만 멀쩡했던 이유 = 네이티브 헤더를 끈 화면이라 어긋날 헤더가 없었다.
 *   → 안쪽에 SafeAreaProvider 를 하나 세우고 `useSafeAreaFrame()` 을 읽는다. 이 값은 네이티브 뷰 계층에서
 *     (Android `offsetDescendantRectToMyCoords`, iOS `convertRect:toView:nil`) 실측한 창 기준 프레임이라 헤더·배너·Modal 창과 무관하게 맞다.
 *     키보드 screenY 도 같은 창 기준이다.
 *
 * ★자식은 안쪽 View 에 담는다 — 채팅의 ＋ 메뉴처럼 `position:'absolute', bottom:…` 으로 뜨는 것은 부모의 **패딩 상자** 기준이라,
 *   패딩을 받는 상자에 직접 두면 키보드 밑으로 들어간다. 안쪽 View 가 키보드 위 영역만 차지하므로 거기 기준으로 뜬 메뉴는 항상 보인다.
 */
export function KeyboardShift({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  // 바깥 컨텍스트를 붙잡아 자식에게 그대로 돌려준다 — 안쪽 SafeAreaProvider 는 **프레임 측정용**일 뿐,
  // 자식이 읽는 insets/frame(시트의 insets.bottom 스페이서 등)이 달라지면 안 된다.
  const outerInsets = useSafeAreaInsets();
  const outerFrame = useSafeAreaFrame();
  return (
    <SafeAreaProvider style={style ?? styles.fill}>
      <Shifter>
        <SafeAreaInsetsContext.Provider value={outerInsets}>
          <SafeAreaFrameContext.Provider value={outerFrame}>{children}</SafeAreaFrameContext.Provider>
        </SafeAreaInsetsContext.Provider>
      </Shifter>
    </SafeAreaProvider>
  );
}

function Shifter({ children }: { children: ReactNode }) {
  // 바로 위 SafeAreaProvider(=이 상자)의 창 기준 프레임. 네이티브가 잰 값이라 레이아웃이 바뀌면 다시 온다.
  const frame = useSafeAreaFrame();
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  const [pad, setPad] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return; // 브라우저는 뷰포트를 스스로 줄인다.
    const onShow = (e: KeyboardEvent) => {
      const bottom = frameRef.current.y + frameRef.current.height;
      const next = Math.max(0, Math.round(bottom - e.endCoordinates.screenY));
      // iOS 는 키보드가 올라오기 전(willShow)에 오므로 키보드 애니에 맞춰 같이 움직인다.
      if (Platform.OS === 'ios' && e.duration) {
        LayoutAnimation.configureNext({
          duration: Math.max(e.duration, 10),
          update: { duration: Math.max(e.duration, 10), type: LayoutAnimation.Types[e.easing] || 'keyboard' },
        });
      }
      setPad(next);
    };
    const onHide = () => setPad(0);
    const subs =
      Platform.OS === 'ios'
        ? [Keyboard.addListener('keyboardWillShow', onShow), Keyboard.addListener('keyboardWillHide', onHide)]
        : [Keyboard.addListener('keyboardDidShow', onShow), Keyboard.addListener('keyboardDidHide', onHide)];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return (
    <View style={[styles.fill, { paddingBottom: pad }]}>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

const styles = { fill: { flex: 1 } as ViewStyle };
