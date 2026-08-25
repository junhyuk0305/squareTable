import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/**
 * 화면 단위 로딩 — 그 화면이 읽는 데이터가 **전부** 도착하기 전에는 이것만 그린다.
 *
 * 규칙 세 줄(2026-08-07 정본 §0-1)
 *  ① 빈 상태 화면이 먼저 스치는 것은 금지 — "정말 없는 것"과 "아직 안 온 것"을 구분한다.
 *  ② 기다리는 동안은 콘텐츠를 **마운트하지 않는다**. 반쯤 채워진 화면을 먼저 보여주지 않는다.
 *  ③ 도착하면 그때 콘텐츠가 처음 마운트되면서 `Appear` 스태거로 통째로 등장한다.
 *
 * `TransitionCover`와 다른 물건이다 — 저건 매장 진입처럼 **화면 전체가 바뀔 때** 덮는 커버(노란 타일 + 스윕)고,
 * 이건 헤더·탭바가 이미 서 있는 화면의 **본문 자리**에 놓는다.
 *
 * `label`은 필수다 — 워딩 §5.3 "무엇을 하는 중인지 말한다"(스피너만 두지 않는다).
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function ScreenLoading({ label }: { label: string }) {
  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={InkColors.ink3} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // flex 1 = 화면을 통째로 대체할 때 세로 중앙. paddingVertical = ScrollView 안에 놓일 때의 최소 높이.
  // 한 스타일로 두 자리를 다 받는다(호출부에 모양 플래그를 만들지 않는다).
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingVertical: Space.xl * 2,
  },
  label: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },
});
