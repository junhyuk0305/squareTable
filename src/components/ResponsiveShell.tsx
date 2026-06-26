import { type ReactNode } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { FRAME_MAX_WIDTH } from '@/lib/theme/layout';

/**
 * 웹에서 가로가 넓어도 모바일 폭(460px)을 유지하고 중앙 정렬 + 좌우 거터.
 * 좁은 화면(실제 모바일/좁은 창)에서는 maxWidth가 자연히 풀폭으로 떨어진다.
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
    ...(isWeb ? { alignItems: 'center' } : null),
  },
  frame: {
    flex: 1,
    width: '100%',
    backgroundColor: InkColors.cream,
    ...(isWeb
      ? {
          maxWidth: FRAME_MAX_WIDTH,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: '#E8E6DF',
        }
      : null),
  },
});
