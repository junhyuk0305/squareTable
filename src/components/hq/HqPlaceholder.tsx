import { View, Text, StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Space, HQ_PAGE_GUTTER } from '@/lib/theme/layout';

/**
 * 본사 화면 자리 표시 — P1(웹 셸)에서는 5메뉴가 전부 비어 있다.
 * 내용은 P3(대시보드·매장·설정) · P4(노하우) · P5(퀴즈)에서 채운다.
 *
 * ★표시 전용이다. 데이터·판정을 넣지 않는다.
 */
export function HqPlaceholder({ title }: { title: string }) {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>준비 중이에요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // 데모 HTML `.page` — 넓은 레이아웃이라 좌우 여백이 폰보다 크다. 폭 캡은 두지 않는다.
  page: { flex: 1, paddingVertical: Space.xl, paddingHorizontal: HQ_PAGE_GUTTER, gap: Space.xs },
  title: { fontSize: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: InkColors.ink3 },
});
