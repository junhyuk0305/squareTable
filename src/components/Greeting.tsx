import { Text, StyleSheet } from 'react-native';

import { Type } from '@/lib/theme/type';
import { Layout } from '@/lib/theme/layout';

/**
 * 인사 문구 — 직원 홈·출퇴근이 같이 쓴다(2026-11-02). 두 화면이 16/700·15/600 으로 따로 정의했었다.
 * Screen 안 첫 줄에 둔다. 섹션 간격(20) 대신 첫 카드까지 `Layout.greetGap`(8)만 띄운다.
 */
export function Greeting({ name }: { name: string }) {
  return <Text style={styles.greet}>{name}님, 오늘도 화이팅이에요</Text>;
}

const styles = StyleSheet.create({
  // 부모 gap(sectionGap)을 음수 여백으로 깎아 greetGap 만 남긴다 — 숫자는 토큰에서만 나온다.
  greet: { ...Type.greet, marginBottom: Layout.greetGap - Layout.sectionGap },
});
