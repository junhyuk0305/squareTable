import { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';

/**
 * 웹에서 가로가 넓어도 모바일 폭을 유지하고 중앙 정렬 + 좌우 거터.
 * 좁은 화면(실제 모바일)에서는 그대로 풀폭.
 *
 * ⚠️ 중앙 정렬은 JS(useWindowDimensions)로 측정하지 않고 CSS 미디어쿼리(+html.tsx)로
 * 처리한다. JS 측정은 SSR 첫 페인트에서 폭을 몰라 풀폭으로 그렸다가 하이드레이션 후
 * 가운데로 점프하는 깜빡임을 만든다. CSS는 첫 바이트부터 적용돼 깜빡임이 없다.
 * nativeID는 웹에서 DOM id로 매핑되고(네이티브에선 무해), 미디어쿼리가 이 id를 타깃한다.
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

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: InkColors.cream },
  frame: { flex: 1, width: '100%', backgroundColor: InkColors.cream },
});
