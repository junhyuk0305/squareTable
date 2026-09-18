import { type ReactNode } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { FRAME_MAX_WIDTH } from '@/lib/theme/layout';

/**
 * 가로가 넓어도 모바일 폭(460px)을 유지하고 중앙 정렬 + 좌우 거터.
 * 좁은 화면(실제 모바일/좁은 창)에서는 maxWidth가 자연히 풀폭으로 떨어진다.
 *
 * ★폭 캡은 네이티브에도 건다(2026-09-18). Android 16(API 36)부터 화면 최소 너비 600dp 이상에서는
 * `orientation: portrait`(screenOrientation)가 **무시**되어, 폴더블을 펴거나 태블릿·데스크톱 모드에
 * 올리면 세로 고정이 안 먹고 가로로 펴진다. 그때 이 캡이 없으면 한 줄이 화면 끝까지 늘어나
 * 레이아웃 불변식 1)이 네이티브에서만 깨진다. `frameCapStyle`·`modalFrameStyle`(모달·시트)은
 * 이미 플랫폼 공통이라, 캡이 빠져 있던 곳은 여기 하나뿐이었다.
 * 좁은 폰에서는 width:'100%' ≤ maxWidth 라 아무 변화가 없다.
 *
 * ⚠️ 중앙 정렬을 컴포넌트 스타일에서 직접 처리한다(외부 CSS/미디어쿼리·nativeID 의존 X).
 * RN Web 0.21에선 nativeID→DOM id 매핑이 보장되지 않아 +html.tsx 미디어쿼리가 안 먹었다.
 * 여기선 maxWidth(고정값)만 쓰므로 윈도 측정이 없어 깜빡임도 없다.
 */
export function ResponsiveShell({ children }: { children: ReactNode }) {
  return (
    <View nativeID="st-outer" style={styles.outer}>
      <View nativeID="st-frame" style={styles.frame}>
        {children}
      </View>
    </View>
  );
}

const isWeb = Platform.OS === 'web';

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: isWeb ? '#E9E7E0' : InkColors.cream, // 웹은 거터를 살짝 어둡게
    alignItems: 'center',
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: FRAME_MAX_WIDTH,
    backgroundColor: InkColors.cream,
    // 테두리는 웹만 — 네이티브는 거터가 같은 크림색이라 선이 뜬금없이 보인다.
    ...(isWeb
      ? {
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: '#E8E6DF',
        }
      : null),
  },
});
